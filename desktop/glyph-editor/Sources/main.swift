import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    let store: EditorStore
    let resources: URL
    let io = DispatchQueue(label: "verba.glyph.files")
    var window: NSWindow!
    var webView: WKWebView!
    var approvedClose = false
    init(store: EditorStore, resources: URL) { self.store = store; self.resources = resources }
    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration()
        configuration.userContentController.add(self, name: "glyphEditor")
        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        window = NSWindow(contentRect: NSRect(x: 100,y: 100,width: 1420,height: 920), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "Verba — редактор гліфів"; window.minSize = NSSize(width: 1000,height: 760)
        window.delegate = self; window.contentView = webView; window.setFrameAutosaveName("VerbaGlyphEditorMain")
        webView.loadFileURL(resources.appendingPathComponent("editor.html"), allowingReadAccessTo: resources)
        if let screen = NSScreen.main {
            window.setContentSize(NSSize(width:max(1000,min(1420,screen.visibleFrame.width-50)),height:max(760,min(920,screen.visibleFrame.height-70))))
            window.center()
        }
        createMenus(); window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps: true)
    }
    func createMenus() {
        let main = NSMenu()
        func group(_ title: String, _ items: [(String, String, String)]) {
            let root = NSMenuItem(title: title, action: nil, keyEquivalent: ""), menu = NSMenu(title: title)
            for (label,key,action) in items {
                let item = NSMenuItem(title: label, action: #selector(menuAction(_:)), keyEquivalent: key)
                item.target = self; item.representedObject = action; if action == "redo" { item.keyEquivalent = "z"; item.keyEquivalentModifierMask = [.command,.shift] }; menu.addItem(item)
            }
            root.submenu = menu; main.addItem(root)
        }
        group("Verba Glyph Editor", [("Про редактор","","about"),("Завершити","q","quit")])
        group("Файл", [("Зберегти правки","s","save"),("Експортувати шрифт","e","export"),("Відкрити папку правок","","project")])
        group("Редагування", [("Скасувати","z","undo"),("Повторити","Z","redo"),("Автозаповнити двійники (А ↔ A)","","autofill"),("Дзеркала й повороти…","","geometry")])
        group("Перегляд", [("Наступний гліф", "]", "next"),("Попередній гліф","[","previous"),("Умістити гліф","0","fit")])

        if let edit = main.item(at: 2)?.submenu {
            edit.addItem(.separator())
            for (title,key,selector) in [("Вирізати","x","cut:"),("Скопіювати","c","copy:"),("Вставити","v","paste:"),("Виділити все","a","selectAll:")] {
                edit.addItem(NSMenuItem(title:title,action:NSSelectorFromString(selector),keyEquivalent:key))
            }
        }
        let windowItem = NSMenuItem(title:"Вікно",action:nil,keyEquivalent:""), windowMenu = NSMenu(title:"Вікно")
        windowMenu.addItem(NSMenuItem(title:"Згорнути",action:#selector(NSWindow.performMiniaturize(_:)),keyEquivalent:"m"))
        windowMenu.addItem(NSMenuItem(title:"Збільшити",action:#selector(NSWindow.performZoom(_:)),keyEquivalent:""))
        windowItem.submenu = windowMenu; main.addItem(windowItem); NSApp.windowsMenu = windowMenu
        NSApp.mainMenu = main
    }
    @objc func menuAction(_ sender: NSMenuItem) {
        let action = sender.representedObject as? String ?? ""
        if action == "quit" { NSApp.terminate(nil); return }
        if action == "about" { NSApp.orderFrontStandardAboutPanel(nil); return }
        if action == "project" { NSWorkspace.shared.open(store.project); return }
        webView.callAsyncJavaScript("if (window.glyphEditorAction) await window.glyphEditorAction(action)", arguments: ["action":action], in: nil, in: .page, completionHandler: nil)
    }
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, message.frameInfo.request.url?.isFileURL == true,
              let body = message.body as? String, let data = body.data(using: .utf8), data.count <= 20*1024*1024,
              let request = try? object(data), let id = request["id"] as? Int, let action = request["action"] as? String else { return }
        let args = request["args"] as? [String: Any] ?? [:]
        if action == "uiReady" {
            print("EDITOR_READY " + ((try? String(data: jsonData(args), encoding: .utf8)) ?? "")); fflush(stdout)
            reply(["id":id,"ok":true,"value":true])
            if CommandLine.arguments.contains("--smoke") {
                flush { success in if success { print("PASS: WKWebView bridge and close/save barrier"); fflush(stdout); self.approvedClose = true; NSApp.terminate(nil) } }
            }
            return
        }
        if action == "revealProject" { NSWorkspace.shared.open(store.project); reply(["id":id,"ok":true,"value":true]); return }
        io.async {
            let response: [String: Any]
            do { response = ["id":id,"ok":true,"value":try self.store.command(action,args)] }
            catch { response = ["id":id,"ok":false,"error":error.localizedDescription] }
            DispatchQueue.main.async { self.reply(response) }
        }
    }
    func reply(_ response: [String: Any]) {
        webView.callAsyncJavaScript("window.__glyphReply(reply)", arguments: ["reply":response], in: nil, in: .page, completionHandler: nil)
    }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy)->Void) {
        guard let url = navigationAction.request.url, url.isFileURL, url.standardizedFileURL.path.hasPrefix(resources.standardizedFileURL.path + "/") else { decisionHandler(.cancel); return }
        decisionHandler(.allow)
    }
    func flush(_ completion: @escaping (Bool)->Void) {
        webView.callAsyncJavaScript("if (window.glyphEditorFlush) await window.glyphEditorFlush(); return true", arguments: [:], in: nil, in: .page) { result in
            switch result {
            case .success: completion(true)
            case .failure(let error):
                let alert = NSAlert(); alert.messageText = "Не вдалося зберегти правки"; alert.informativeText = error.localizedDescription
                alert.addButton(withTitle: "Залишитися в редакторі"); alert.runModal(); completion(false)
            }
        }
    }
    func windowShouldClose(_ sender: NSWindow) -> Bool {
        if approvedClose { return true }
        flush { success in if success { self.approvedClose = true; self.window.performClose(nil) } }; return false
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if approvedClose { return .terminateNow }
        flush { success in self.approvedClose = success; sender.reply(toApplicationShouldTerminate: success) }; return .terminateLater
    }
}
func argument(_ key: String) -> String? {
    guard let i = CommandLine.arguments.firstIndex(of: key), i+1 < CommandLine.arguments.count else { return nil }; return CommandLine.arguments[i+1]
}
func selfTest(_ store: EditorStore) throws {
    let id = store.fonts.first!["id"] as! String, font = try store.summary(id)
    let state: [String: Any] = ["format":"para-glyph-edits","schemaVersion":1,"fontId":id,"snapshot":store.snapshot,
        "baseSha256":font["sha256"]!,"revision":2,"edits":[:],"reviewed":["U+0490"],"created":[],"done":false]
    _ = try store.saveState(id,state:state)
    guard let restored = try store.readState(id) as? [String: Any], restored["revision"] as? Int == 2 else { throw fail("Round trip failed") }
    var stale = state; stale["revision"] = 1
    do { _ = try store.saveState(id,state:stale); throw fail("Stale write accepted") } catch EditorError.message(let text) where text.hasPrefix("Новіші") {}
    var wrong = state; wrong["baseSha256"] = "wrong"
    do { _ = try store.saveState(id,state:wrong); throw fail("Wrong source accepted") } catch EditorError.message(let text) where text.hasPrefix("Правки") {}
    do { _ = try store.asset("/para/corpus/"+store.snapshot+"/../secret.json"); throw fail("Traversal accepted") } catch EditorError.message(let text) where text.hasPrefix("Недозволений") {}
    do { _ = try EditorStore(corpus: store.corpus, project: store.project); throw fail("Concurrent project open accepted") } catch EditorError.message(let text) where text.hasPrefix("Цей проєкт") {}
    print("PASS: native atomic persistence, stale-write/source guards, path confinement, exclusive project lock")
}
do {
    let resources = Bundle.main.resourceURL ?? URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
    let config = (try? object(Data(contentsOf: resources.appendingPathComponent("configuration.json")))) ?? [:]
    let root = argument("--corpus") ?? ProcessInfo.processInfo.environment["VERBA_GLYPH_CORPUS"] ?? config["corpusRoot"] as? String ?? ""
    let project = argument("--project").map { URL(fileURLWithPath: $0) }
    let store = try EditorStore(corpus: URL(fileURLWithPath: root), project: project)
    if CommandLine.arguments.contains("--self-test") { try selfTest(store) }
    else if let port = argument("--serve-preview").flatMap(UInt16.init) {
        let directory = argument("--resources").map { URL(fileURLWithPath: $0) } ?? resources
        let server = try PreviewServer(port:port,store:store,resources:directory)
        withExtendedLifetime(server) { dispatchMain() }
    } else {
        let app = NSApplication.shared, delegate = AppDelegate(store:store,resources:resources)
        app.setActivationPolicy(.regular); app.delegate = delegate
        withExtendedLifetime(delegate) { app.run() }
    }
} catch {
    fputs("Verba Glyph Editor: \(error.localizedDescription)\n",stderr)
    if !CommandLine.arguments.contains("--self-test") && argument("--serve-preview") == nil {
        let app = NSApplication.shared; app.setActivationPolicy(.regular)
        let alert = NSAlert(); alert.messageText = "Не вдалося відкрити корпус"; alert.informativeText = error.localizedDescription; alert.runModal()
    }
    exit(1)
}
