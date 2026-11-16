// A filtering event tap like the ones of hotkey, dictation and scroll tools, and a list of the taps of the session.
import CoreGraphics
import Foundation

let locations: [String: CGEventTapLocation] = ["hid": .cghidEventTap, "session": .cgSessionEventTap, "annotated": .cgAnnotatedSessionEventTap]
let groups: [String: [CGEventType]] = [
  "keys": [.keyDown, .keyUp],
  "flags": [.flagsChanged],
  "buttons": [.leftMouseDown, .leftMouseUp, .rightMouseDown, .rightMouseUp, .otherMouseDown, .otherMouseUp],
  "drags": [.leftMouseDragged, .rightMouseDragged, .otherMouseDragged],
  "moves": [.mouseMoved],
  "wheel": [.scrollWheel],
]

func fail(_ message: String) -> Never {
  FileHandle.standardError.write("\(message)\n".data(using: .utf8)!)
  exit(2)
}

func need<T>(_ value: T?, _ message: String) -> T {
  guard let value else { fail(message) }
  return value
}

func taps() -> [CGEventTapInformation] {
  var count: UInt32 = 0
  CGGetEventTapList(0, nil, &count)
  var list = [CGEventTapInformation](repeating: CGEventTapInformation(), count: Int(count))
  CGGetEventTapList(count, &list, &count)
  return Array(list.prefix(Int(count)))
}

func list() {
  for t in taps() {
    let location = locations.first { $0.value == t.tapPoint }!.key
    let line: [String: Any] = [
      "pid": t.tappingProcess, "location": location, "filter": t.options == .defaultTap, "enabled": t.enabled,
      "mask": t.eventsOfInterest, "avgLatencyUs": t.avgUsecLatency, "maxLatencyUs": t.maxUsecLatency,
    ]
    print(String(data: try! JSONSerialization.data(withJSONObject: line, options: .sortedKeys), encoding: .utf8)!)
  }
}

struct Hold {
  var location = CGEventTapLocation.cghidEventTap
  var mask: CGEventMask = 0
  var delayUs: UInt32 = 0
  var drop = false
  var log = false
}

func parse(_ args: ArraySlice<String>) -> Hold {
  var hold = Hold()
  var rest = args
  while let arg = rest.popFirst() {
    switch arg {
    case "--location": hold.location = need(locations[rest.popFirst() ?? ""], "--location takes \(locations.keys.sorted())")
    case "--delay-ms": hold.delayUs = need(UInt32(rest.popFirst() ?? ""), "--delay-ms takes a number") * 1000
    case "--drop": hold.drop = true
    case "--log": hold.log = true
    case "--events":
      for name in (rest.popFirst() ?? "").split(separator: ",") {
        for type in need(groups[String(name)], "--events takes \(groups.keys.sorted())") { hold.mask |= 1 << type.rawValue }
      }
    default: fail("unknown argument \(arg)")
    }
  }
  if hold.mask == 0 { fail("--events is required") }
  return hold
}

var hold = Hold()
var port: CFMachPort?

let callback: CGEventTapCallBack = { _, type, event, _ in
  if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
    FileHandle.standardError.write("re-enabled after \(type == .tapDisabledByTimeout ? "timeout" : "user input")\n".data(using: .utf8)!)
    CGEvent.tapEnable(tap: port!, enable: true)
    return Unmanaged.passUnretained(event)
  }
  if hold.log {
    print("seen type=\(type.rawValue) source=\(event.getIntegerValueField(.eventSourceUnixProcessID)) data=\(event.getIntegerValueField(.eventSourceUserData))")
  }
  usleep(hold.delayUs)
  return hold.drop ? nil : Unmanaged.passUnretained(event)
}

let args = CommandLine.arguments.dropFirst()
switch args.first {
case "list":
  list()
case "hold":
  hold = parse(args.dropFirst())
  setvbuf(stdout, nil, _IOLBF, 0)
  guard let tap = CGEvent.tapCreate(tap: hold.location, place: .headInsertEventTap, options: .defaultTap,
                                    eventsOfInterest: hold.mask, callback: callback, userInfo: nil) else {
    fail("CGEventTapCreate failed: grant Accessibility to this program")
  }
  port = tap
  CFRunLoopAddSource(CFRunLoopGetCurrent(), CFMachPortCreateRunLoopSource(nil, tap, 0), .commonModes)
  CGEvent.tapEnable(tap: tap, enable: true)
  guard taps().contains(where: { $0.tappingProcess == getpid() && $0.enabled }) else { fail("the tap is not enabled") }
  signal(SIGTERM) { _ in exit(0) }
  print("ready pid=\(getpid())")
  CFRunLoopRun()
default:
  fail("usage: taps list | taps hold --location hid|session|annotated --events \(groups.keys.sorted().joined(separator: ",")) [--delay-ms N] [--drop] [--log]")
}
