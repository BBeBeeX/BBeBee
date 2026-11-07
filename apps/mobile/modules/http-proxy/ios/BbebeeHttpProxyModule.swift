import Foundation
import ExpoModulesCore

/**
 * `BbebeeHttpProxy` — the iOS half of the proxy-capable fetch.
 *
 * The JS adapter (`modules/http-proxy/index.ts`) installs this module's
 * surface as `globalThis.bbebeeProxyHttp`, the seam `HttpRn` uses for
 * requests the settings marked `useProxy`. The proxy config travels with
 * every call — there is no native state to invalidate when settings change.
 *
 * Threading: the `AsyncFunction` body hops onto a dedicated serial queue and
 * resolves through a checked continuation, so the shared Expo queue and the
 * JS thread are never held by an in-flight request.
 *
 * Redirects are deliberately NOT followed: `HttpNode.followRedirects` loops
 * in JS so every hop re-checks the host allowlist and re-injects cookies —
 * the session delegate cancels them here.
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
}

/// A mutable bridge across the semaphore wait: the delegate resolves with
/// `Result<(HTTPURLResponse, Data), Error>`, which generics + a closure
/// property make awkward to read back; the box holds it until the wait ends.
private final class BoxedResult {
  private var value: Result<(HTTPURLResponse, Data), Error>?

  func set(_ result: Result<(HTTPURLResponse, Data), Error>) {
    value = result
  }

  func take() -> Result<(HTTPURLResponse, Data), Error>? {
    let taken = value
    value = nil
    return taken
  }
}

/// The session delegate: cancels redirects (the JS loop owns hops), answers a
/// proxy auth challenge with the stored credentials, and buffers the body.
private final class ProxySessionDelegate: NSObject, URLSessionDataDelegate {
  private let proxyCredentials: (String, String)?
  private let buffer = NSMutableData()
  private var response: HTTPURLResponse?
  var onDone: ((Result<(HTTPURLResponse, Data), Error>) -> Void)?

  init(proxyCredentials: (String, String)?) {
    self.proxyCredentials = proxyCredentials
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    willPerformHTTPRedirection response: HTTPURLResponse,
    newRequest request: URLRequest,
    completionHandler: @escaping (URLRequest?) -> Void
  ) {
    // Not following: `HttpNode.followRedirects` re-issues each hop itself so
    // the host gate and cookie jar see every one.
    completionHandler(nil)
  }

  func urlSession(
    _ session: URLSession,
    task: URLSessionTask,
    didReceive challenge: URLAuthenticationChallenge,
    completionHandler: @escaping (URLSession.AuthChallengeDisposition, URLCredential?) -> Void
  ) {
    let method = challenge.protectionSpace.authenticationMethod
    let isProxyAuth = challenge.protectionSpace.isProxy
    if isProxyAuth, challenge.previousFailureCount == 0, let credentials = proxyCredentials,
       method == NSURLAuthenticationMethodHTTPBasic || method == NSURLAuthenticationMethodNTLM {
      completionHandler(
        .useCredential,
        URLCredential(user: credentials.0, password: credentials.1, persistence: .forSession)
      )
      return
    }
    completionHandler(.performDefaultHandling)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                  completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
    if let httpResponse = response as? HTTPURLResponse {
      self.response = httpResponse
    }
    completionHandler(.allow)
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    buffer.append(data)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let onDone else { return }
    if let error {
      onDone(.failure(error))
      return
    }
    guard let response else {
      onDone(.failure(NSError(domain: "BbebeeHttpProxy", code: 6,
                              userInfo: [NSLocalizedDescriptionKey: "no response received"])))
      return
    }
    onDone(.success((response, buffer as Data)))
  }
}
