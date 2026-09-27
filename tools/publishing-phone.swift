// Agentcut's small local input bridge. No network access or social account logic.
import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    exit(1)
}
let arguments = Array(CommandLine.arguments.dropFirst())
let operation = arguments.first ?? "info"
guard let application = NSRunningApplication.runningApplications(withBundleIdentifier: "com.apple.ScreenContinuity").first else { fail("Open iPhone Mirroring") }
if operation == "focus" { application.activate(); Thread.sleep(forTimeInterval: 0.8) }
let windows = CGWindowListCopyWindowInfo(.optionOnScreenOnly, kCGNullWindowID) as? [[String: Any]] ?? []
guard let window = windows.first(where: { ($0[kCGWindowOwnerPID as String] as? Int32) == application.processIdentifier && ($0[kCGWindowLayer as String] as? Int) == 0 }),
      let bounds = window[kCGWindowBounds as String] as? NSDictionary,
      let rectangle = CGRect(dictionaryRepresentation: bounds),
      let identifier = window[kCGWindowNumber as String] as? UInt32 else { fail("No visible Mirroring window") }
let focused = NSWorkspace.shared.frontmostApplication?.processIdentifier == application.processIdentifier
if operation == "info" || operation == "focus" {
    print("id=\(identifier) x=\(rectangle.minX) y=\(rectangle.minY) w=\(rectangle.width) h=\(rectangle.height) frontmost=\(focused) trusted=\(AXIsProcessTrusted())")
    exit(0)
}
guard focused && AXIsProcessTrusted() else { fail("Refused: focus and Accessibility required") }
func number(_ index: Int) -> Double { guard arguments.count > index, let n = Double(arguments[index]), n.isFinite else { fail("Invalid coordinate") }; return n }
func sendKey(_ code: CGKeyCode, _ flags: CGEventFlags = []) {
    for down in [true, false] { let event = CGEvent(keyboardEventSource: nil, virtualKey: code, keyDown: down); event?.flags = flags; event?.post(tap: .cghidEventTap) }
}
switch operation {
case "tap", "scroll":
    let x = number(1), y = number(2)
    guard x >= 0 && x <= rectangle.width && y >= 0 && y <= rectangle.height else { fail("Point outside window") }
    let point = CGPoint(x: rectangle.minX + x, y: rectangle.minY + y)
    CGEvent(mouseEventSource: nil, mouseType: .mouseMoved, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap)
    if operation == "tap" {
        for kind in [CGEventType.leftMouseDown, .leftMouseUp] { CGEvent(mouseEventSource: nil, mouseType: kind, mouseCursorPosition: point, mouseButton: .left)?.post(tap: .cghidEventTap); Thread.sleep(forTimeInterval: 0.06) }
    } else {
        let amount = Int32(max(-1000, min(1000, number(3))))
        let event = CGEvent(scrollWheelEvent2Source: nil, units: .line, wheelCount: 1, wheel1: amount, wheel2: 0, wheel3: 0)
        event?.location = point; event?.post(tap: .cghidEventTap)
    }
case "paste":
    guard arguments.count > 1 else { fail("Text required") }
    NSPasteboard.general.clearContents()
    NSPasteboard.general.setString(arguments[1], forType: .string)
    Thread.sleep(forTimeInterval: 0.5)
    sendKey(9, .maskCommand)
    Thread.sleep(forTimeInterval: 3)
case "key":
    let keys: [String: CGKeyCode] = ["return":36,"tab":48,"space":49,"delete":51,"escape":53,"left":123,"right":124,"down":125,"up":126,"a":0,"c":8,"v":9,"1":18,"2":19,"3":20,"4":21,"5":23,"6":22,"7":26,"8":28,"9":25,"0":29]
    guard arguments.count > 1, let key = keys[arguments[1]] else { fail("Unsupported key") }
    var flags: CGEventFlags = []
    if arguments.count > 2 { if arguments[2] == "cmd" { flags = .maskCommand } else if arguments[2] == "shift" { flags = .maskShift } else { fail("Unsupported modifier") } }
    sendKey(key, flags)
default: fail("Unsupported action")
}
Thread.sleep(forTimeInterval: 0.3)
print("done; verify the screen")
