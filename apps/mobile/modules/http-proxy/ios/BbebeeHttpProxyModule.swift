import Foundation
import Network
import ExpoModulesCore

/**
 * `BbebeeHttpProxy` — the iOS half of the proxy-capable HTTP for the app:
 *
 *  - `proxyFetch`: one stateless, proxy-dialing HTTP call — the seam `HttpRn`
 *    uses for requests the settings marked `useProxy`. The proxy config
 *    travels with every call — no native state to invalidate.
 *  - `relayRegister`: one registration in the **loopback stream relay** —
 *    the seam `core-audio-mpv` uses for proxy-marked playback streams. mpv
 *    fetches `http://127.0.0.1:<port>/s/<token>`; an NWListener on the
 *    loopback accepts, the relay dials the real upstream through the
 *    registered proxy (URLSession with a connectionProxyDictionary) and
 *    streams the bytes over, forwarding the Range exchanges seeking
 *    depends on.
 *
 * Threading: the `AsyncFunction` bodies hop onto a dedicated serial queue and
 * resolve through a checked continuation, so the shared Expo queue and the
 * JS thread are never held by an in-flight request. The relay runs on its
 * own queue.
 *
 * For `proxyFetch`, redirects are deliberately NOT followed:
 * `HttpNode.followRedirects` loops in JS so every hop re-checks the host
 * allowlist and re-injects cookies — the session delegate cancels them here.
 * The relay follows redirects: its upstream was registered by the shell, and
 * mpv itself follows redirects when it plays direct.
 *
 * Proxy shapes: `http`/`https` (TLS-to-proxy is NOT supported by
 * `connectionProxyDictionary` — an `https` proxy config is dialled as a plain
 * HTTP CONNECT proxy, which is what most "https" proxies in the wild are),
 * and `socks5` through the CFNetwork SOCKS keys, with user/password when
 * given. Known degradation: `allHeaderFields` merges repeated header names,
 * so multiple `Set-Cookie` responses arrive joined — documented in
 * docs/services/contracts.md.
 */
public class BbebeeHttpProxyModule: Module {
  /// Serializes every call — the Android "module thread" equivalent.
  private let fetchQueue = DispatchQueue(label: "expo.modules.httpproxy.fetch", qos: .userInitiated)
  /// Owns the relay listener and every connection it accepts.
  private let relayQueue = DispatchQueue(label: "expo.modules.httpproxy.relay", qos: .userInitiated)
  private var relayListener: NWListener?
  private var relayPort: UInt16 = 0
  private var relayEntries: [String: RelayEntry] = [:]

  override public func definition() -> ModuleDefinition {
    Name("BbebeeHttpProxy")

    AsyncFunction("proxyFetch") { (options: [String: Any], promise: Promise) in
      self.fetchQueue.async {
        do {
          let result = try self.proxyFetch(options: options)
          promise.resolve(result)
        } catch {
          promise.reject(CodedException(error: error))
        }
      }
    }

    AsyncFunction("relayRegister") { (options: [String: Any], promise: Promise) in
      self.fetchQueue.async {
        do {
          let url = try self.relayRegister(options: options)
          promise.resolve(["url": url])
        } catch {
          promise.reject(CodedException(error: error))
        }
      }
    }
  }

  // MARK: - Internals

  struct ProxyEndpoint {
    let protocolKind: String
    let host: String
    let port: Int
    let username: String?
    let password: String?
  }

  struct FetchAnswer {
    let status: Int
    let statusText: String
    let url: String
    let headers: [[String]]
    let bodyBase64: String
  }

  func proxyFetch(options: [String: Any]) throws -> [String: Any] {
    guard let urlText = options["url"] as? String, let url = URL(string: urlText) else {
      throw NSError(domain: "BbebeeHttpProxy", code: 1,
                    userInfo: [NSLocalizedDescriptionKey: "url is required"])
    }
    let method = (options["method"] as? String ?? "GET").uppercased()
    let headers = options["headers"] as? [String: String] ?? [:]
    let bodyBase64 = options["bodyBase64"] as? String
    let timeoutMs = (options["timeoutMs"] as? NSNumber)?.doubleValue ?? 30_000
    guard let proxyOptions = options["proxy"] as? [String: Any] else {
      throw NSError(domain: "BbebeeHttpProxy", code: 2,
                    userInfo: [NSLocalizedDescriptionKey: "proxy config is required"])
    }
    guard let host = proxyOptions["host"] as? String, !host.isEmpty,
          let port = (proxyOptions["port"] as? NSNumber)?.intValue, port > 0 else {
      throw NSError(domain: "BbebeeHttpProxy", code: 3,
                    userInfo: [NSLocalizedDescriptionKey: "proxy host and port are required"])
    }
    let endpoint = ProxyEndpoint(
      protocolKind: proxyOptions["protocol"] as? String ?? "http",
      host: host,
      port: port,
      username: proxyOptions["username"] as? String,
      password: proxyOptions["password"] as? String
    )

    var request = URLRequest(url: url, timeoutInterval: timeoutMs / 1000.0)
    request.httpMethod = method
    for (name, value) in headers {
      request.setValue(value, forHTTPHeaderField: name)
    }
    if let bodyBase64, method != "GET", method != "HEAD",
       let body = Data(base64Encoded: bodyBase64, options: [.ignoreUnknownCharacters]) {
      request.httpBody = body
    }

    let answer = try perform(request: request, endpoint: endpoint, timeoutMs: timeoutMs)
    return [
      "status": answer.status,
      "statusText": answer.statusText,
      "url": answer.url,
      "headers": answer.headers,
      "bodyBase64": answer.bodyBase64
    ]
  }

  private func perform(request: URLRequest, endpoint: ProxyEndpoint, timeoutMs: Double) throws -> FetchAnswer {
    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = timeoutMs / 1000.0
    configuration.timeoutIntervalForResource = timeoutMs / 1000.0 + 5
    configuration.httpShouldSetCookies = false
    configuration.connectionProxyDictionary = Self.proxyDictionary(for: endpoint)

    let delegate = ProxySessionDelegate(proxyCredentials: proxyCredentials(endpoint))
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    defer { session.finishTasksAndInvalidate() }

    let semaphore = DispatchSemaphore(value: 0)
    // The delegate resolves through the box; the semaphore hands control back
    // to this (module-queue) thread once the transfer settled either way.
    let boxed = BoxedResult()
    delegate.onDone = { result in
      boxed.set(result)
      semaphore.signal()
    }

    let task = session.dataTask(with: request)
    task.resume()
    if semaphore.wait(timeout: .now() + DispatchTimeInterval.milliseconds(Int(timeoutMs) + 6_000)) == .timedOut {
      task.cancel()
      throw NSError(domain: "BbebeeHttpProxy", code: 4,
                    userInfo: [NSLocalizedDescriptionKey: "proxied fetch timed out"])
    }

    guard let boxed, let outcome = boxed.take() else {
      throw NSError(domain: "BbebeeHttpProxy", code: 5,
                    userInfo: [NSLocalizedDescriptionKey: "proxied fetch produced no answer"])
    }
    let (response, data) = try outcome.get()

    var headerPairs: [[String]] = []
    for (rawName, rawValue) in response.allHeaderFields {
      guard let name = rawName as? String, let value = rawValue as? String else { continue }
      headerPairs.append([name, value])
    }
    return FetchAnswer(
      status: response.statusCode,
      statusText: HTTPURLResponse.localizedString(forStatusCode: response.statusCode),
      url: response.url?.absoluteString ?? request.url?.absoluteString ?? "",
      headers: headerPairs,
      bodyBase64: data.base64EncodedString()
    )
  }

  private func proxyCredentials(_ endpoint: ProxyEndpoint) -> (String, String)? {
    if endpoint.username?.isEmpty == false || endpoint.password?.isEmpty == false {
      return (endpoint.username ?? "", endpoint.password ?? "")
    }
    return nil
  }

  /// The CFNetwork proxy dictionary for one endpoint.
  ///
  /// `https` degrades to an HTTP CONNECT proxy (TLS-to-proxy has no
  /// `connectionProxyDictionary` story); SOCKS5 uses the CFStream keys, which
  /// URLSession honours through CFNetwork.
  static func proxyDictionary(for endpoint: ProxyEndpoint) -> [String: Any] {
    if endpoint.protocolKind == "socks5" {
      var dict: [String: Any] = [
        kCFStreamPropertySOCKSProxyHost as String: endpoint.host,
        kCFStreamPropertySOCKSProxyPort as String: endpoint.port
      ]
      if endpoint.username?.isEmpty == false {
        dict[kCFStreamPropertySOCKSUser as String] = endpoint.username ?? ""
      }
      if endpoint.password?.isEmpty == false {
        dict[kCFStreamPropertySOCKSPassword as String] = endpoint.password ?? ""
      }
      return dict
    }
    return [
      kCFNetworkProxiesHTTPEnable as String: true,
      kCFNetworkProxiesHTTPProxy as String: endpoint.host,
      kCFNetworkProxiesHTTPPort as String: endpoint.port,
      kCFNetworkProxiesHTTPSEnable as String: true,
      kCFNetworkProxiesHTTPSProxy as String: endpoint.host,
      kCFNetworkProxiesHTTPSPort as String: endpoint.port
    ]
  }
  // MARK: - The loopback stream relay

  private final class RelayEntry {
    let url: String
    let headers: [String: String]
    let proxy: [String: Any]
    let createdAt = Date()
    var lastAccess = Date()

    init(url: String, headers: [String: String], proxy: [String: Any]) {
      self.url = url
      self.headers = headers
      self.proxy = proxy
    }
  }

  /** Ceiling on live registrations — a loop must evict, not grow. */
  private static let relayMaxEntries = 128
  /** Registrations outlive any sane track; a seek reuses the same token. */
  private static let relayEntryTtl: TimeInterval = 2 * 60 * 60

  /// mpv's exchange-shaping headers, forwarded upstream alongside the source's own.
  private static let relayForwardedRequestHeaders: Set<String> = [
    "range", "if-range", "accept", "accept-encoding", "icy-metadata"
  ]

  /// Hop-by-hop and session-shaped response headers never handed to mpv.
  private static let relayDroppedResponseHeaders: Set<String> = [
    "connection", "keep-alive", "transfer-encoding", "upgrade",
    "proxy-authenticate", "proxy-authorization", "set-cookie",
    "strict-transport-security"
  ]

  private func relayRegister(options: [String: Any]) throws -> String {
    guard let url = options["url"] as? String else {
      throw NSError(domain: "BbebeeHttpProxy", code: 10,
                    userInfo: [NSLocalizedDescriptionKey: "url is required"])
    }
    guard url.lowercased().hasPrefix("http://") || url.lowercased().hasPrefix("https://") else {
      throw NSError(domain: "BbebeeHttpProxy", code: 11,
                    userInfo: [NSLocalizedDescriptionKey: "only http/https upstreams are served"])
    }
    guard let proxy = options["proxy"] as? [String: Any] else {
      throw NSError(domain: "BbebeeHttpProxy", code: 12,
                    userInfo: [NSLocalizedDescriptionKey: "proxy config is required"])
    }
    let headers = (options["headers"] as? [String: String]) ?? [:]

    try ensureRelayListener()
    sweepRelay()

    var tokenBytes = [UInt8](repeating: 0, count: 16)
    _ = SecRandomCopyBytes(kSecRandomDefault, tokenBytes.count, &tokenBytes)
    let token = tokenBytes.map { String(format: "%02x", $0) }.joined()
    relayEntries[token] = RelayEntry(url: url, headers: headers, proxy: proxy)
    return "http://127.0.0.1:\(relayPort)/s/\(token)"
  }

  /// Lazily start the loopback listener; the port is the OS's choice.
  private func ensureRelayListener() throws {
    if relayListener != nil, relayPort != 0 { return }
    let parameters = NWParameters.tcp
    parameters.requiredLocalEndpoint = NWEndpoint.hostPort(host: "127.0.0.1", port: .any)
    let listener = try NWListener(using: parameters)
    listener.newConnectionHandler = { [weak self] connection in
      self?.handleRelayConnection(connection)
    }
    let portPromise = PortPromise()
    listener.stateUpdateHandler = { [weak self] state in
      if case .ready = state {
        self?.relayPort = listener.port?.rawValue ?? 0
        portPromise.fulfill(UInt16(self?.relayPort ?? 0))
      }
      if case .failed = state {
        portPromise.fail()
      }
    }
    listener.start(queue: relayQueue)
    relayListener = listener
    // The listener becomes ready on `relayQueue`; this call already runs there.
    try portPromise.wait(timeout: .now() + 5)
  }

  private func sweepRelay() {
    let now = Date()
    relayEntries = relayEntries.filter { now.timeIntervalSince($0.value.lastAccess) < Self.relayEntryTtl }
    while relayEntries.count >= Self.relayMaxEntries {
      guard let oldest = relayEntries.min(by: { $0.value.lastAccess < $1.value.lastAccess })?.key else { break }
      relayEntries.removeValue(forKey: oldest)
    }
  }

  private func handleRelayConnection(_ connection: NWConnection) {
    connection.start(queue: relayQueue)
    receiveRequestHead(connection, buffer: Data())
  }

  /// Reads until the blank line that ends the request head, then dispatches.
  private func receiveRequestHead(_ connection: NWConnection, buffer: Data) {
    if let terminator = buffer.range(of: Data("\r\n\r\n".utf8)) {
      let headData = buffer.subdata(in: buffer.startIndex..<terminator.lowerBound)
      dispatchRelayRequest(connection, head: headData)
      return
    }
    if buffer.count > 32 * 1024 {
      connection.cancel()
      return
    }
    connection.receive(minimumIncompleteLength: 1, maximumLength: 16 * 1024) { [weak self] data, _, _, error in
      guard let self else { return }
      if let data, !data.isEmpty {
        var accumulated = buffer
        accumulated.append(data)
        self.receiveRequestHead(connection, buffer: accumulated)
        return
      }
      // EOF or error before a complete head: nothing to serve.
      connection.cancel()
      _ = error
    }
  }

  private func dispatchRelayRequest(_ connection: NWConnection, head: Data) {
    let headText = String(decoding: head, as: UTF8.self)
    var lines = headText.split(separator: "\r\n", omittingEmptySubsequences: false).makeIterator()
    guard let requestLine = lines.next() else {
      writeSimpleRelayResponse(connection, statusLine: "HTTP/1.1 400 Bad Request", body: "bad request")
      return
    }
    let parts = requestLine.split(separator: " ")
    guard parts.count >= 2 else {
      writeSimpleRelayResponse(connection, statusLine: "HTTP/1.1 400 Bad Request", body: "bad request")
      return
    }
    let method = parts[0].uppercased()
    let path = String(parts[1])

    var requestHeaders: [String: String] = [:]
    for line in lines {
      guard let idx = line.firstIndex(of: ":") else { continue }
      let name = String(line[line.startIndex..<idx]).trimmingCharacters(in: .whitespaces).lowercased()
      let value = String(line[line.index(after: idx)...]).trimmingCharacters(in: .whitespaces)
      requestHeaders[name] = value
    }

    // `/s/<token>` — a token is capability, not identity: unknown and expired
    // get the same flat 404, with nothing to distinguish them for a prober.
    guard path.hasPrefix("/s/"), path.count > "/s/".count else {
      writeSimpleRelayResponse(connection, statusLine: "HTTP/1.1 404 Not Found", body: "not found")
      return
    }
    let token = String(path.dropFirst("/s/".count))
    guard let entry = relayEntries[token] else {
      writeSimpleRelayResponse(connection, statusLine: "HTTP/1.1 404 Not Found", body: "not found")
      return
    }
    entry.lastAccess = Date()

    var request = URLRequest(url: URL(string: entry.url)!)
    request.httpMethod = method == "HEAD" ? "HEAD" : "GET"
    for name in Self.relayForwardedRequestHeaders {
      if let value = requestHeaders[name] {
        request.setValue(value, forHTTPHeaderField: name)
      }
    }
    for (name, value) in entry.headers {
      request.setValue(value, forHTTPHeaderField: name)
    }

    let configuration = URLSessionConfiguration.ephemeral
    configuration.timeoutIntervalForRequest = 30
    configuration.timeoutIntervalForResource = 2 * 60 * 60
    configuration.httpShouldSetCookies = false
    configuration.connectionProxyDictionary = Self.proxyDictionary(for: Self.endpoint(from: entry.proxy))
    let writer = RelayWriter(connection: connection)
    let delegate = RelayStreamDelegate(writer: writer,
                                       proxyCredentials: Self.proxyCredentials(entry.proxy))
    let session = URLSession(configuration: configuration, delegate: delegate, delegateQueue: nil)
    delegate.onFinish = { [weak session] in session?.finishTasksAndInvalidate() }
    let task = session.dataTask(with: request)
    task.resume()
  }

  private func writeSimpleRelayResponse(_ connection: NWConnection, statusLine: String, body: String) {
    let bodyData = Data(body.utf8)
    let head = Data("\(statusLine)\r\nContent-Type: text/plain\r\nContent-Length: \(bodyData.count)\r\nConnection: close\r\n\r\n".utf8)
    connection.send(content: head + bodyData, isComplete: true, completion: .contentProcessed { _ in
      connection.cancel()
    })
  }

  private static func endpoint(from proxy: [String: Any]) -> ProxyEndpoint {
    ProxyEndpoint(
      protocolKind: proxy["protocol"] as? String ?? "http",
      host: proxy["host"] as? String ?? "",
      port: (proxy["port"] as? NSNumber)?.intValue ?? 0,
      username: proxy["username"] as? String,
      password: proxy["password"] as? String
    )
  }

  private static func proxyCredentials(_ proxy: [String: Any]) -> (String, String)? {
    let username = proxy["username"] as? String
    let password = proxy["password"] as? String
    if username?.isEmpty == false || password?.isEmpty == false {
      return (username ?? "", password ?? "")
    }
    return nil
  }
}

private final class RelayWriter {
  private let connection: NWConnection
  private var pending: Data?
  private var closed = false
  private let lock = NSLock()

  init(connection: NWConnection) {
    self.connection = connection
  }

  func write(_ data: Data) {
    lock.lock()
    if pending == nil {
      pending = data
      lock.unlock()
      sendNext()
    } else {
      pending?.append(data)
      lock.unlock()
    }
  }

  func finish() {
    lock.lock()
    closed = true
    let hasPending = pending != nil
    lock.unlock()
    if !hasPending {
      connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
        self.connection.cancel()
      })
    }
  }

  private func sendNext() {
    lock.lock()
    guard !closed, let chunk = pending else {
      lock.unlock()
      if closed {
        connection.send(content: nil, contentContext: .finalMessage, isComplete: true, completion: .contentProcessed { _ in
          self.connection.cancel()
        })
      }
      return
    }
    pending = nil
    lock.unlock()
    connection.send(content: chunk, isComplete: false, completion: .contentProcessed { [weak self] _ in
      self?.sendNext()
    })
  }
}

/// The relay's URLSession delegate: follows redirects (default handling),
/// answers proxy auth challenges, and streams every data chunk into the
/// NWConnection. Response headers are written by the first-chunk hook.

private final class RelayStreamDelegate: NSObject, URLSessionDataDelegate {
  private let writer: RelayWriter
  private let proxyCredentials: (String, String)?
  private var headWritten = false
  var onFinish: (() -> Void)?

  init(writer: RelayWriter, proxyCredentials: (String, String)?) {
    self.writer = writer
    self.proxyCredentials = proxyCredentials
  }

  func urlSession(
    _ session: URLSession,
    dataTask: URLSessionDataTask,
    didReceive response: URLResponse,
    completionHandler: @escaping (URLSession.ResponseDisposition) -> Void
  ) {
    if let httpResponse = response as? HTTPURLResponse {
      var head = "HTTP/1.1 \(httpResponse.statusCode) \(HTTPURLResponse.localizedString(forStatusCode: httpResponse.statusCode))\r\n"
      for (rawName, rawValue) in httpResponse.allHeaderFields {
        guard let name = rawName as? String, let value = rawValue as? String else { continue }
        let lower = name.lowercased()
        if Self.relayDroppedResponseHeaders.contains(lower) || lower == "content-length" || lower == "content-encoding" {
          continue
        }
        head += "\(name): \(value)\r\n"
      }
      // Body length is delimited by the connection close we control after the
      // last chunk — URLSession hands us decoded bytes, so the upstream
      // Content-Length cannot be trusted to match.
      head += "Connection: close\r\n\r\n"
      writer.write(Data(head.utf8))
    }
    headWritten = true
    completionHandler(.allow)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let method = challenge.protectionSpace.authenticationMethod
    if challenge.protectionSpace.isProxy, challenge.previousFailureCount == 0, let credentials = proxyCredentials,
       method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodNTLM {
      completionHandler(
        .useCredential,
        URLCredential(user: credentials.0, password: credentials.1, persistence: .forSession)
      )
      return
    }
    completionHandler(.performDefaultHandling)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    writer.write(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    writer.finish()
    onFinish?()
  }
}
__zcode_status=$?
if [ "$__zcode_status" -eq 0 ]; then pwd -P > '/tmp/zcode-9764d95b-708c-4ac4-aa83-ec38224350a3-cwd'; fi
exit "$__zcode_status"
