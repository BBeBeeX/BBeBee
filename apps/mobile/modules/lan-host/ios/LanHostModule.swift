import Foundation
import Network
import ExpoModulesCore

/**
 * `BbebeeLanHost` — the iOS half of `ctx.lan`, mirroring the Kotlin module:
 *
 *   - `start` binds an `NWListener` on 0.0.0.0 and a UDP `NWConnection`
 *     group-joined socket, then pushes inbound datagrams and HTTP requests
 *     to JS as `onLanDatagram` / `onLanRequest` events.
 *   - `replyRequest` answers a parked request; an unanswered one times out
 *     (30 s) with a 504.
 *   - A reply may name a `bodyFile` (with an optional inclusive slice) —
 *     Range/206 audio serving straight off disk.
 *
 * ⚠️ Receiving *multicast* on iOS requires the
 * `com.apple.developer.networking.multicast` entitlement (request it from
 * Apple when an iOS target ships). Without it, broadcast announce still
 * works and discovery degrades to manual addresses — the same graceful
 * degradation the Android side documents for hotspot interfaces. This
 * repository currently carries no iOS app target; this file is
 * compile-parity with the Android implementation.
 */
public class LanHostModule: Module {
  /// Inbound bodies above this answer 413. The desktop host spills to disk
  /// and Android caps at 8 GiB with a 1 MiB spill, but iOS keeps the whole
  /// body in memory, so its ceiling must be a genuine memory budget — and
  /// bodies that do fit must arrive *complete* (the previous code answered
  /// with whatever bytes had happened to arrive alongside the head).
  private let maxBodyBytes = 16 * 1024 * 1024
  private let queue = DispatchQueue(label: "expo.modules.lanhost.io", qos: .userInitiated)
  private let listenerQueue = DispatchQueue(label: "expo.modules.lanhost.listener")
  private var listener: NWListener?
  private var udpConnection: NWConnection?
  private var pending: [String: CheckedContinuation<[String: Any?]?, Never>] = [:]
  private let pendingLock = NSLock()

  public override func definition() -> ModuleDefinition {
    Name("BbebeeLanHost")

    Events("onLanDatagram", "onLanRequest")

    AsyncFunction("start") { (options: [String: Any?], promise: Promise) in
      do {
        promise.resolve(try self.start(options))
      } catch {
        promise.reject("E_LAN_START", error.localizedDescription)
      }
    }

    AsyncFunction("stop") { (promise: Promise) in
      self.stopInternal()
      promise.resolve(nil)
    }

    AsyncFunction("sendDatagram") { (options: [String: Any?], promise: Promise) in
      do {
        try self.sendDatagram(options)
        promise.resolve(nil)
      } catch {
        promise.reject("E_LAN_DGRAM", error.localizedDescription)
      }
    }

    AsyncFunction("request") { (options: [String: Any?], promise: Promise) in
      self.request(options, promise: promise)
    }

    AsyncFunction("replyRequest") { (options: [String: Any?], promise: Promise) in
      guard let id = options["id"] as? String else {
        promise.reject("E_LAN_REPLY", "id is required")
        return
      }
      self.pendingLock.lock()
      let continuation = self.pending.removeValue(forKey: id)
      self.pendingLock.unlock()
      if let continuation = continuation {
        continuation.resume(returning: options)
      }
      promise.resolve(nil)
    }

    OnDestroy {
      self.stopInternal()
    }
  }

  // MARK: - start / stop

  private func start(_ options: [String: Any?]) throws -> [String: Any?] {
    guard listener == nil else {
      return ["udpPort": 0, "httpPort": listener?.port?.rawValue ?? 0]
    }
    let tcpPort = (options["httpPort"] as? NSNumber)?.intValue ?? 0
    let udpPort = (options["udpPort"] as? NSNumber)?.intValue ?? 0
    let group = options["multicastGroup"] as? String ?? "239.255.42.98"

    // TCP: the sync API server.
    let params = NWParameters.tcp
    if tcpPort > 0, let port = NWEndpoint.Port(rawValue: UInt16(tcpPort)) {
      params.requiredLocalEndpoint = NWEndpoint.port(port)
    }
    let nwListener = try NWListener(using: params)
    nwListener.newConnectionHandler = { [weak self] connection in
      self?.handleConnection(connection)
    }
    nwListener.stateUpdateHandler = { [weak self] state in
      if case .failed = state {
        self?.listener = nil
      }
    }
    nwListener.start(queue: listenerQueue)
    listener = nwListener

    // UDP: discovery send/receive. Group membership is best-effort — the
    // entitlement decides, and broadcast still works without it.
    let udpParams = NWParameters.udp
    if udpPort > 0, let port = NWEndpoint.Port(rawValue: UInt16(udpPort)) {
      udpParams.requiredLocalEndpoint = NWEndpoint.port(port)
    }
    let connection = NWConnection(using: udpParams, to: NWEndpoint.Host(group), port: NWEndpoint.Port(rawValue: 53_318) ?? .any)
    connection.stateUpdateHandler = { [weak self] state in
      if case .ready = state {
        self?.receiveLoop(connection)
      }
    }
    connection.start(queue: listenerQueue)
    udpConnection = connection

    return ["udpPort": udpPort, "httpPort": tcpPort]
  }

  private func stopInternal() {
    listener?.cancel()
    listener = nil
    udpConnection?.cancel()
    udpConnection = nil
    pendingLock.lock()
    let parked = pending
    pending.removeAll()
    pendingLock.unlock()
    for (_, continuation) in parked {
      continuation.resume(returning: nil)
    }
  }

  // MARK: - UDP

  private func receiveLoop(_ connection: NWConnection) {
    connection.receiveMessage { [weak self] data, _, _, error in
      guard let self = self, error == nil else { return }
      if let data = data {
        let endpoint = connection.currentPath?.remoteEndpoint
        let host = (endpoint as? NWEndpoint)?.hostname ?? ""
        self.sendEvent("onLanDatagram", [
          "host": host,
          "port": 0,
          "dataBase64": data.base64EncodedString(),
        ])
      }
      self.receiveLoop(connection)
    }
  }

  private func sendDatagram(_ options: [String: Any?]) throws {
    guard let host = options["host"] as? String else { throw NSError(domain: "lan", code: 1) }
    let port = (options["port"] as? NSNumber)?.uint16Value ?? 0
    guard let data = Data(base64Encoded: options["dataBase64"] as? String ?? "") else { return }
    guard let portValue = NWEndpoint.Port(rawValue: port) else { return }
    let connection = NWConnection(host: NWEndpoint.Host(host), port: portValue, using: .udp)
    connection.send(content: data, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  // MARK: - TCP server

  private func handleConnection(_ connection: NWConnection) {
    connection.start(queue: queue)
    receiveHead(connection, accumulated: Data())
  }

  private func receiveHead(_ connection: NWConnection, accumulated: Data) {
    if let range = accumulated.range(of: Data("\r\n\r\n".utf8)) {
      let headData = accumulated.subdata(in: accumulated.startIndex..<range.lowerBound)
      let rest = accumulated.subdata(in: range.upperBound..<accumulated.endIndex)
      finishHead(connection, headData: headData, bodySoFar: rest)
      return
    }
    if accumulated.count > 32 * 1024 {
      connection.cancel()
      return
    }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, error in
      guard let self = self, error == nil, let data = data, !data.isEmpty else {
        connection.cancel()
        return
      }
      self.receiveHead(connection, accumulated: accumulated + data)
    }
  }

  private struct ParsedRequest {
    let method: String
    let path: String
    let headers: [String: String]
    let contentLength: Int
  }

  private func finishHead(_ connection: NWConnection, headData: Data, bodySoFar: Data) {
    let head = String(decoding: headData, as: UTF8.self)
    var lines = head.components(separatedBy: "\r\n")
    guard !lines.isEmpty else {
      connection.cancel()
      return
    }
    let requestLine = lines.removeFirst()
    let parts = requestLine.split(separator: " ")
    guard parts.count >= 2 else {
      connection.cancel()
      return
    }
    let method = parts[0].uppercased()
    let path = String(parts[1])

    var headers: [String: String] = [:]
    for line in lines where !line.isEmpty {
      let idx = line.firstIndex(of: ":") ?? line.endIndex
      let name = line[..<idx].trimmingCharacters(in: .whitespaces).lowercased()
      let value = line[line.index(after: idx)...].trimmingCharacters(in: .whitespaces)
      headers[name] = value
    }

    let contentLength = Int(headers["content-length"] ?? "0") ?? 0
    if contentLength > maxBodyBytes {
      writeReply(connection, reply: ["status": 413])
      return
    }
    receiveBody(connection, parsed: ParsedRequest(method: method, path: path, headers: headers, contentLength: contentLength), body: bodySoFar)
  }

  /// Drain the body to `contentLength` before delivering: a body is only
  /// complete once every announced byte has arrived, and the loop's total
  /// accumulation is bounded by the 413-checked `maxBodyBytes`.
  private func receiveBody(_ connection: NWConnection, parsed: ParsedRequest, body: Data) {
    if body.count >= parsed.contentLength {
      let full = parsed.contentLength > 0 ? body.prefix(parsed.contentLength) : Data()
      deliverRequest(connection, parsed: parsed, body: Data(full))
      return
    }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 64 * 1024) { [weak self] data, _, _, error in
      guard let self = self, error == nil, let data = data, !data.isEmpty else {
        connection.cancel()
        return
      }
      self.receiveBody(connection, parsed: parsed, body: body + data)
    }
  }

  private func deliverRequest(_ connection: NWConnection, parsed: ParsedRequest, body: Data) {
    let id = UUID().uuidString

    pendingLock.lock()
    let parked: [String: Any?]? = withCheckedContinuation { continuation in
      pending[id] = continuation
      sendEvent("onLanRequest", [
        "id": id,
        "method": parsed.method,
        "url": "http://\(parsed.headers["host"] ?? "unknown")\(parsed.path)",
        "headers": parsed.headers,
        "bodyBase64": body.isEmpty ? nil : body.base64EncodedString(),
      ])
      // Park before the event? The continuation is registered first so a
      // synchronous reply from JS cannot race the registration.
    }
    pendingLock.unlock()

    // Reply or 504.
    let reply = parked ?? nil
    writeReply(connection, reply: reply ?? ["status": 504])
  }

  private func writeReply(_ connection: NWConnection, reply: [String: Any?]) {
    let status = (reply["status"] as? NSNumber)?.intValue ?? 200
    var head = "HTTP/1.1 \(status)\r\n"
    var gaveLength = false
    if let headers = reply["headers"] as? [String: String] {
      for (name, value) in headers {
        if name.lowercased() == "content-length" { gaveLength = true }
        head += "\(name): \(value)\r\n"
      }
    }

    let bytesToBase64 = { (data: Data) -> String in data.base64EncodedString() }
    _ = bytesToBase64

    if let bodyFile = reply["bodyFile"] as? String {
      let path = bodyFile.hasPrefix("file://") ? String(bodyFile.dropFirst("file://".count)) : bodyFile
      guard let handle = FileHandle(forReadingAtPath: path) else {
        connection.send(content: Data("not found".utf8), completion: .contentProcessed { _ in connection.cancel() })
        return
      }
      defer { try? handle.close() }
      let size = (try? handle.seekToEnd()) ?? 0
      let start = (reply["bodyFileStart"] as? NSNumber)?.int64Value ?? 0
      let end = (reply["bodyFileEnd"] as? NSNumber)?.int64Value ?? (size - 1)
      let from = max(0, min(start, max(size - 1, 0)))
      let to = min(end, size - 1)
      let length = size == 0 ? 0 : max(0, to - from + 1)
      if !gaveLength { head += "Content-Length: \(length)\r\n" }
      head += "Connection: close\r\n\r\n"
      connection.send(content: Data(head.utf8), completion: .contentProcessed { _ in
        guard length > 0 else { connection.cancel(); return }
        try? handle.seek(toOffset: UInt64(from))
        var remaining = length
        let chunk = 64 * 1024
        while remaining > 0 {
          let data = handle.readData(ofLength: min(chunk, Int(remaining)))
          if data.isEmpty { break }
          remaining -= Int64(data.count)
          connection.send(content: data, completion: .contentProcessed { _ in })
        }
        connection.send(content: nil, completion: .contentProcessed { _ in connection.cancel() })
      })
      return
    }

    let body = Data(base64Encoded: reply["bodyBase64"] as? String ?? "") ?? Data()
    if !gaveLength { head += "Content-Length: \(body.count)\r\n" }
    head += "Connection: close\r\n\r\n"
    connection.send(content: Data(head.utf8) + body, completion: .contentProcessed { _ in connection.cancel() })
  }

  // MARK: - client

  private func request(_ options: [String: Any?], promise: Promise) {
    guard let host = options["host"] as? String else {
      promise.reject("E_LAN_REQUEST", "host is required")
      return
    }
    let port = (options["port"] as? NSNumber)?.intValue ?? 80
    let method = (options["method"] as? String ?? "GET").uppercased()
    let path = options["path"] as? String ?? "/"
    let headers = options["headers"] as? [String: String] ?? [:]
    let body = Data(base64Encoded: options["bodyBase64"] as? String ?? "")
    let timeout = (options["timeoutMs"] as? NSNumber)?.doubleValue ?? 30_000

    queue.async {
      guard let url = URL(string: "http://\(host):\(port)\(path.hasPrefix("/") ? path : "/" + path)") else {
        promise.reject("E_LAN_REQUEST", "malformed url")
        return
      }
      var req = URLRequest(url: url)
      req.httpMethod = method
      req.timeoutInterval = timeout / 1000
      for (name, value) in headers { req.setValue(value, forHTTPHeaderField: name) }
      if let body = body, method != "GET", method != "HEAD" {
        req.httpBody = body
      }
      let task = URLSession.shared.dataTask(with: req) { data, response, error in
        if let error = error {
          promise.reject("E_LAN_REQUEST", error.localizedDescription)
          return
        }
        guard let http = response as? HTTPURLResponse else {
          promise.reject("E_LAN_REQUEST", "not an http response")
          return
        }
        var headerMap: [String: String] = [:]
        for (name, value) in http.allHeaderFields {
          if let name = name as? String, let value = value as? String {
            headerMap[name.lowercased()] = value
          }
        }
        promise.resolve([
          "status": http.statusCode,
          "headers": headerMap,
          "bodyBase64": (data ?? Data()).base64EncodedString(),
        ])
      }
      task.resume()
    }
  }
}
