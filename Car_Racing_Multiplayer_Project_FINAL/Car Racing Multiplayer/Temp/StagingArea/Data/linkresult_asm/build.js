Module["preRun"].push((function() {
 var unityFileSystemInit = Module["unityFileSystemInit"] || (function() {
  if (!Module.indexedDB) {
   console.log("IndexedDB is not available. Data will not persist in cache and PlayerPrefs will not be saved.");
  }
  FS.mkdir("/idbfs");
  FS.mount(IDBFS, {}, "/idbfs");
  Module.addRunDependency("JS_FileSystem_Mount");
  FS.syncfs(true, (function(err) {
   Module.removeRunDependency("JS_FileSystem_Mount");
  }));
 });
 unityFileSystemInit();
}));
Module["SetFullscreen"] = (function(fullscreen) {
 if (typeof runtimeInitialized === "undefined" || !runtimeInitialized) {
  console.log("Runtime not initialized yet.");
 } else if (typeof JSEvents === "undefined") {
  console.log("Player not loaded yet.");
 } else {
  var tmp = JSEvents.canPerformEventHandlerRequests;
  JSEvents.canPerformEventHandlerRequests = (function() {
   return 1;
  });
  Module.ccall("SetFullscreen", null, [ "number" ], [ fullscreen ]);
  JSEvents.canPerformEventHandlerRequests = tmp;
 }
});
integrateWasmJS = function integrateWasmJS(Module) {
 var method = Module["wasmJSMethod"] || "native-wasm";
 Module["wasmJSMethod"] = method;
 var wasmTextFile = Module["wasmTextFile"] || "build.wast";
 var wasmBinaryFile = Module["wasmBinaryFile"] || "build.wasm";
 var asmjsCodeFile = Module["asmjsCodeFile"] || "build.asm.js";
 var wasmPageSize = 64 * 1024;
 var asm2wasmImports = {
  "f64-rem": (function(x, y) {
   return x % y;
  }),
  "f64-to-int": (function(x) {
   return x | 0;
  }),
  "i32s-div": (function(x, y) {
   return (x | 0) / (y | 0) | 0;
  }),
  "i32u-div": (function(x, y) {
   return (x >>> 0) / (y >>> 0) >>> 0;
  }),
  "i32s-rem": (function(x, y) {
   return (x | 0) % (y | 0) | 0;
  }),
  "i32u-rem": (function(x, y) {
   return (x >>> 0) % (y >>> 0) >>> 0;
  }),
  "debugger": (function() {
   debugger;
  })
 };
 var info = {
  "global": null,
  "env": null,
  "asm2wasm": asm2wasmImports,
  "parent": Module
 };
 var exports = null;
 function lookupImport(mod, base) {
  var lookup = info;
  if (mod.indexOf(".") < 0) {
   lookup = (lookup || {})[mod];
  } else {
   var parts = mod.split(".");
   lookup = (lookup || {})[parts[0]];
   lookup = (lookup || {})[parts[1]];
  }
  if (base) {
   lookup = (lookup || {})[base];
  }
  if (lookup === undefined) {
   abort("bad lookupImport to (" + mod + ")." + base);
  }
  return lookup;
 }
 function mergeMemory(newBuffer) {
  var oldBuffer = Module["buffer"];
  if (newBuffer.byteLength < oldBuffer.byteLength) {
   Module["printErr"]("the new buffer in mergeMemory is smaller than the previous one. in native wasm, we should grow memory here");
  }
  var oldView = new Int8Array(oldBuffer);
  var newView = new Int8Array(newBuffer);
  if (!memoryInitializer) {
   oldView.set(newView.subarray(Module["STATIC_BASE"], Module["STATIC_BASE"] + Module["STATIC_BUMP"]), Module["STATIC_BASE"]);
  }
  newView.set(oldView);
  updateGlobalBuffer(newBuffer);
  updateGlobalBufferViews();
 }
 var WasmTypes = {
  none: 0,
  i32: 1,
  i64: 2,
  f32: 3,
  f64: 4
 };
 function fixImports(imports) {
  if (!0) return imports;
  var ret = {};
  for (var i in imports) {
   var fixed = i;
   if (fixed[0] == "_") fixed = fixed.substr(1);
   ret[fixed] = imports[i];
  }
  return ret;
 }
 function getBinary() {
  var binary;
  if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
   binary = Module["wasmBinary"];
   assert(binary, "on the web, we need the wasm binary to be preloaded and set on Module['wasmBinary']. emcc.py will do that for you when generating HTML (but not JS)");
   binary = new Uint8Array(binary);
  } else {
   binary = Module["readBinary"](wasmBinaryFile);
  }
  return binary;
 }
 function doJustAsm(global, env, providedBuffer) {
  if (typeof Module["asm"] !== "function" || Module["asm"] === methodHandler) {
   if (!Module["asmPreload"]) {
    eval(Module["read"](asmjsCodeFile));
   } else {
    Module["asm"] = Module["asmPreload"];
   }
  }
  if (typeof Module["asm"] !== "function") {
   Module["printErr"]("asm evalling did not set the module properly");
   return false;
  }
  return Module["asm"](global, env, providedBuffer);
 }
 function doNativeWasm(global, env, providedBuffer) {
  if (typeof WebAssembly !== "object") {
   Module["printErr"]("no native wasm support detected");
   return false;
  }
  if (!(Module["wasmMemory"] instanceof WebAssembly.Memory)) {
   Module["printErr"]("no native wasm Memory in use");
   return false;
  }
  env["memory"] = Module["wasmMemory"];
  info["global"] = {
   "NaN": NaN,
   "Infinity": Infinity
  };
  info["global.Math"] = global.Math;
  info["env"] = env;
  function receiveInstance(instance) {
   exports = instance.exports;
   if (exports.memory) mergeMemory(exports.memory);
   Module["usingWasm"] = true;
  }
  Module["print"]("asynchronously preparing wasm");
  addRunDependency("wasm-instantiate");
  WebAssembly.instantiate(getBinary(), info).then((function(output) {
   receiveInstance(output.instance);
   asm = Module["asm"] = exports;
   Runtime.stackAlloc = exports["stackAlloc"];
   Runtime.stackSave = exports["stackSave"];
   Runtime.stackRestore = exports["stackRestore"];
   Runtime.establishStackSpace = exports["establishStackSpace"];
   Runtime.setTempRet0 = exports["setTempRet0"];
   Runtime.getTempRet0 = exports["getTempRet0"];
   removeRunDependency("wasm-instantiate");
  }));
  return {};
  var instance;
  try {
   instance = new WebAssembly.Instance(new WebAssembly.Module(getBinary()), info);
  } catch (e) {
   Module["printErr"]("failed to compile wasm module: " + e);
   if (e.toString().indexOf("imported Memory with incompatible size") >= 0) {
    Module["printErr"]("Memory size incompatibility issues may be due to changing TOTAL_MEMORY at runtime to something too large. Use ALLOW_MEMORY_GROWTH to allow any size memory (and also make sure not to set TOTAL_MEMORY at runtime to something smaller than it was at compile time).");
   }
   return false;
  }
  receiveInstance(instance);
  return exports;
 }
 function doWasmPolyfill(global, env, providedBuffer, method) {
  if (typeof WasmJS !== "function") {
   Module["printErr"]("WasmJS not detected - polyfill not bundled?");
   return false;
  }
  var wasmJS = WasmJS({});
  wasmJS["outside"] = Module;
  wasmJS["info"] = info;
  wasmJS["lookupImport"] = lookupImport;
  assert(providedBuffer === Module["buffer"]);
  info.global = global;
  info.env = env;
  assert(providedBuffer === Module["buffer"]);
  env["memory"] = providedBuffer;
  assert(env["memory"] instanceof ArrayBuffer);
  wasmJS["providedTotalMemory"] = Module["buffer"].byteLength;
  var code;
  if (method === "interpret-binary") {
   code = getBinary();
  } else {
   code = Module["read"](method == "interpret-asm2wasm" ? asmjsCodeFile : wasmTextFile);
  }
  var temp;
  if (method == "interpret-asm2wasm") {
   temp = wasmJS["_malloc"](code.length + 1);
   wasmJS["writeAsciiToMemory"](code, temp);
   wasmJS["_load_asm2wasm"](temp);
  } else if (method === "interpret-s-expr") {
   temp = wasmJS["_malloc"](code.length + 1);
   wasmJS["writeAsciiToMemory"](code, temp);
   wasmJS["_load_s_expr2wasm"](temp);
  } else if (method === "interpret-binary") {
   temp = wasmJS["_malloc"](code.length);
   wasmJS["HEAPU8"].set(code, temp);
   wasmJS["_load_binary2wasm"](temp, code.length);
  } else {
   throw "what? " + method;
  }
  wasmJS["_free"](temp);
  wasmJS["_instantiate"](temp);
  if (Module["newBuffer"]) {
   mergeMemory(Module["newBuffer"]);
   Module["newBuffer"] = null;
  }
  exports = wasmJS["asmExports"];
  return exports;
 }
 Module["asmPreload"] = Module["asm"];
 Module["reallocBuffer"] = (function(size) {
  size = Math.ceil(size / wasmPageSize) * wasmPageSize;
  var old = Module["buffer"];
  var result = exports["__growWasmMemory"](size / wasmPageSize);
  if (Module["usingWasm"]) {
   if (result !== (-1 | 0)) {
    return Module["buffer"] = Module["wasmMemory"].buffer;
   } else {
    return null;
   }
  } else {
   return Module["buffer"] !== old ? Module["buffer"] : null;
  }
 });
 Module["asm"] = (function(global, env, providedBuffer) {
  global = fixImports(global);
  env = fixImports(env);
  if (!env["table"]) {
   var TABLE_SIZE = Module["wasmTableSize"];
   if (TABLE_SIZE === undefined) TABLE_SIZE = 1024;
   var MAX_TABLE_SIZE = Module["wasmMaxTableSize"];
   if (typeof WebAssembly === "object" && typeof WebAssembly.Table === "function") {
    if (MAX_TABLE_SIZE !== undefined) {
     env["table"] = new WebAssembly.Table({
      initial: TABLE_SIZE,
      maximum: MAX_TABLE_SIZE,
      element: "anyfunc"
     });
    } else {
     env["table"] = new WebAssembly.Table({
      initial: TABLE_SIZE,
      element: "anyfunc"
     });
    }
   } else {
    env["table"] = new Array(TABLE_SIZE);
   }
   Module["wasmTable"] = env["table"];
  }
  if (!env["memoryBase"]) {
   env["memoryBase"] = Module["STATIC_BASE"];
  }
  if (!env["tableBase"]) {
   env["tableBase"] = 0;
  }
  var exports;
  var methods = method.split(",");
  for (var i = 0; i < methods.length; i++) {
   var curr = methods[i];
   Module["print"]("trying binaryen method: " + curr);
   if (curr === "native-wasm") {
    if (exports = doNativeWasm(global, env, providedBuffer)) break;
   } else if (curr === "asmjs") {
    if (exports = doJustAsm(global, env, providedBuffer)) break;
   } else if (curr === "interpret-asm2wasm" || curr === "interpret-s-expr" || curr === "interpret-binary") {
    if (exports = doWasmPolyfill(global, env, providedBuffer, curr)) break;
   } else {
    throw "bad method: " + curr;
   }
  }
  if (!exports) throw "no binaryen method succeeded. consider enabling more options, like interpreting, if you want that: https://github.com/kripken/emscripten/wiki/WebAssembly#binaryen-methods";
  Module["print"]("binaryen method succeeded.");
  return exports;
 });
 var methodHandler = Module["asm"];
};
Module["demangle"] = demangle || (function(symbol) {
 return symbol;
});
var MediaDevices = [];
Module["preRun"].push((function() {
 var enumerateMediaDevices = (function() {
  var getMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia;
  if (!getMedia) return;
  function addDevice(label) {
   label = label ? label : "device #" + MediaDevices.length;
   var device = {
    deviceName: label,
    refCount: 0,
    video: null
   };
   MediaDevices.push(device);
  }
  if (!navigator.mediaDevices || !navigator.mediaDevices.enumerateDevices) {
   if (typeof MediaStreamTrack == "undefined" || typeof MediaStreamTrack.getSources == "undefined") {
    console.log("Media Devices cannot be enumerated on this browser.");
    return;
   }
   function gotSources(sourceInfos) {
    for (var i = 0; i !== sourceInfos.length; ++i) {
     var sourceInfo = sourceInfos[i];
     if (sourceInfo.kind === "video") addDevice(sourceInfo.label);
    }
   }
   MediaStreamTrack.getSources(gotSources);
  }
  navigator.mediaDevices.enumerateDevices().then((function(devices) {
   devices.forEach((function(device) {
    if (device.kind == "videoinput") addDevice(device.label);
   }));
  })).catch((function(err) {
   console.log(err.name + ": " + error.message);
  }));
 });
 enumerateMediaDevices();
}));
function SendMessage(gameObject, func, param) {
 if (param === undefined) Module.ccall("SendMessage", null, [ "string", "string" ], [ gameObject, func ]); else if (typeof param === "string") Module.ccall("SendMessageString", null, [ "string", "string", "string" ], [ gameObject, func, param ]); else if (typeof param === "number") Module.ccall("SendMessageFloat", null, [ "string", "string", "number" ], [ gameObject, func, param ]); else throw "" + param + " is does not have a type which is supported by SendMessage.";
}
Module["SendMessage"] = SendMessage;
var Module;
if (!Module) Module = (typeof Module !== "undefined" ? Module : null) || {};
var moduleOverrides = {};
for (var key in Module) {
 if (Module.hasOwnProperty(key)) {
  moduleOverrides[key] = Module[key];
 }
}
var ENVIRONMENT_IS_WEB = false;
var ENVIRONMENT_IS_WORKER = false;
var ENVIRONMENT_IS_NODE = false;
var ENVIRONMENT_IS_SHELL = false;
if (Module["ENVIRONMENT"]) {
 if (Module["ENVIRONMENT"] === "WEB") {
  ENVIRONMENT_IS_WEB = true;
 } else if (Module["ENVIRONMENT"] === "WORKER") {
  ENVIRONMENT_IS_WORKER = true;
 } else if (Module["ENVIRONMENT"] === "NODE") {
  ENVIRONMENT_IS_NODE = true;
 } else if (Module["ENVIRONMENT"] === "SHELL") {
  ENVIRONMENT_IS_SHELL = true;
 } else {
  throw new Error("The provided Module['ENVIRONMENT'] value is not valid. It must be one of: WEB|WORKER|NODE|SHELL.");
 }
} else {
 ENVIRONMENT_IS_WEB = typeof window === "object";
 ENVIRONMENT_IS_WORKER = typeof importScripts === "function";
 ENVIRONMENT_IS_NODE = typeof process === "object" && typeof require === "function" && !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_WORKER;
 ENVIRONMENT_IS_SHELL = !ENVIRONMENT_IS_WEB && !ENVIRONMENT_IS_NODE && !ENVIRONMENT_IS_WORKER;
}
if (ENVIRONMENT_IS_NODE) {
 if (!Module["print"]) Module["print"] = console.log;
 if (!Module["printErr"]) Module["printErr"] = console.warn;
 var nodeFS;
 var nodePath;
 Module["read"] = function read(filename, binary) {
  if (!nodeFS) nodeFS = require("fs");
  if (!nodePath) nodePath = require("path");
  filename = nodePath["normalize"](filename);
  var ret = nodeFS["readFileSync"](filename);
  return binary ? ret : ret.toString();
 };
 Module["readBinary"] = function readBinary(filename) {
  var ret = Module["read"](filename, true);
  if (!ret.buffer) {
   ret = new Uint8Array(ret);
  }
  assert(ret.buffer);
  return ret;
 };
 Module["load"] = function load(f) {
  globalEval(read(f));
 };
 if (!Module["thisProgram"]) {
  if (process["argv"].length > 1) {
   Module["thisProgram"] = process["argv"][1].replace(/\\/g, "/");
  } else {
   Module["thisProgram"] = "unknown-program";
  }
 }
 Module["arguments"] = process["argv"].slice(2);
 if (typeof module !== "undefined") {
  module["exports"] = Module;
 }
 process["on"]("uncaughtException", (function(ex) {
  if (!(ex instanceof ExitStatus)) {
   throw ex;
  }
 }));
 Module["inspect"] = (function() {
  return "[Emscripten Module object]";
 });
} else if (ENVIRONMENT_IS_SHELL) {
 if (!Module["print"]) Module["print"] = print;
 if (typeof printErr != "undefined") Module["printErr"] = printErr;
 if (typeof read != "undefined") {
  Module["read"] = read;
 } else {
  Module["read"] = function read() {
   throw "no read() available";
  };
 }
 Module["readBinary"] = function readBinary(f) {
  if (typeof readbuffer === "function") {
   return new Uint8Array(readbuffer(f));
  }
  var data = read(f, "binary");
  assert(typeof data === "object");
  return data;
 };
 if (typeof scriptArgs != "undefined") {
  Module["arguments"] = scriptArgs;
 } else if (typeof arguments != "undefined") {
  Module["arguments"] = arguments;
 }
} else if (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) {
 Module["read"] = function read(url) {
  var xhr = new XMLHttpRequest;
  xhr.open("GET", url, false);
  xhr.send(null);
  return xhr.responseText;
 };
 Module["readAsync"] = function readAsync(url, onload, onerror) {
  var xhr = new XMLHttpRequest;
  xhr.open("GET", url, true);
  xhr.responseType = "arraybuffer";
  xhr.onload = function xhr_onload() {
   if (xhr.status == 200 || xhr.status == 0 && xhr.response) {
    onload(xhr.response);
   } else {
    onerror();
   }
  };
  xhr.onerror = onerror;
  xhr.send(null);
 };
 if (typeof arguments != "undefined") {
  Module["arguments"] = arguments;
 }
 if (typeof console !== "undefined") {
  if (!Module["print"]) Module["print"] = function print(x) {
   console.log(x);
  };
  if (!Module["printErr"]) Module["printErr"] = function printErr(x) {
   console.warn(x);
  };
 } else {
  var TRY_USE_DUMP = false;
  if (!Module["print"]) Module["print"] = TRY_USE_DUMP && typeof dump !== "undefined" ? (function(x) {
   dump(x);
  }) : (function(x) {});
 }
 if (ENVIRONMENT_IS_WORKER) {
  Module["load"] = importScripts;
 }
 if (typeof Module["setWindowTitle"] === "undefined") {
  Module["setWindowTitle"] = (function(title) {
   document.title = title;
  });
 }
} else {
 throw "Unknown runtime environment. Where are we?";
}
function globalEval(x) {
 eval.call(null, x);
}
if (!Module["load"] && Module["read"]) {
 Module["load"] = function load(f) {
  globalEval(Module["read"](f));
 };
}
if (!Module["print"]) {
 Module["print"] = (function() {});
}
if (!Module["printErr"]) {
 Module["printErr"] = Module["print"];
}
if (!Module["arguments"]) {
 Module["arguments"] = [];
}
if (!Module["thisProgram"]) {
 Module["thisProgram"] = "./this.program";
}
Module.print = Module["print"];
Module.printErr = Module["printErr"];
Module["preRun"] = [];
Module["postRun"] = [];
for (var key in moduleOverrides) {
 if (moduleOverrides.hasOwnProperty(key)) {
  Module[key] = moduleOverrides[key];
 }
}
moduleOverrides = undefined;
var Runtime = {
 setTempRet0: (function(value) {
  tempRet0 = value;
 }),
 getTempRet0: (function() {
  return tempRet0;
 }),
 stackSave: (function() {
  return STACKTOP;
 }),
 stackRestore: (function(stackTop) {
  STACKTOP = stackTop;
 }),
 getNativeTypeSize: (function(type) {
  switch (type) {
  case "i1":
  case "i8":
   return 1;
  case "i16":
   return 2;
  case "i32":
   return 4;
  case "i64":
   return 8;
  case "float":
   return 4;
  case "double":
   return 8;
  default:
   {
    if (type[type.length - 1] === "*") {
     return Runtime.QUANTUM_SIZE;
    } else if (type[0] === "i") {
     var bits = parseInt(type.substr(1));
     assert(bits % 8 === 0);
     return bits / 8;
    } else {
     return 0;
    }
   }
  }
 }),
 getNativeFieldSize: (function(type) {
  return Math.max(Runtime.getNativeTypeSize(type), Runtime.QUANTUM_SIZE);
 }),
 STACK_ALIGN: 16,
 prepVararg: (function(ptr, type) {
  if (type === "double" || type === "i64") {
   if (ptr & 7) {
    assert((ptr & 7) === 4);
    ptr += 4;
   }
  } else {
   assert((ptr & 3) === 0);
  }
  return ptr;
 }),
 getAlignSize: (function(type, size, vararg) {
  if (!vararg && (type == "i64" || type == "double")) return 8;
  if (!type) return Math.min(size, 8);
  return Math.min(size || (type ? Runtime.getNativeFieldSize(type) : 0), Runtime.QUANTUM_SIZE);
 }),
 dynCall: (function(sig, ptr, args) {
  if (args && args.length) {
   assert(args.length == sig.length - 1);
   assert("dynCall_" + sig in Module, "bad function pointer type - no table for sig '" + sig + "'");
   return Module["dynCall_" + sig].apply(null, [ ptr ].concat(args));
  } else {
   assert(sig.length == 1);
   assert("dynCall_" + sig in Module, "bad function pointer type - no table for sig '" + sig + "'");
   return Module["dynCall_" + sig].call(null, ptr);
  }
 }),
 functionPointers: [],
 addFunction: (function(func) {
  for (var i = 0; i < Runtime.functionPointers.length; i++) {
   if (!Runtime.functionPointers[i]) {
    Runtime.functionPointers[i] = func;
    return 2 * (1 + i);
   }
  }
  throw "Finished up all reserved function pointers. Use a higher value for RESERVED_FUNCTION_POINTERS.";
 }),
 removeFunction: (function(index) {
  Runtime.functionPointers[(index - 2) / 2] = null;
 }),
 warnOnce: (function(text) {
  if (!Runtime.warnOnce.shown) Runtime.warnOnce.shown = {};
  if (!Runtime.warnOnce.shown[text]) {
   Runtime.warnOnce.shown[text] = 1;
   Module.printErr(text);
  }
 }),
 funcWrappers: {},
 getFuncWrapper: (function(func, sig) {
  assert(sig);
  if (!Runtime.funcWrappers[sig]) {
   Runtime.funcWrappers[sig] = {};
  }
  var sigCache = Runtime.funcWrappers[sig];
  if (!sigCache[func]) {
   if (sig.length === 1) {
    sigCache[func] = function dynCall_wrapper() {
     return Runtime.dynCall(sig, func);
    };
   } else if (sig.length === 2) {
    sigCache[func] = function dynCall_wrapper(arg) {
     return Runtime.dynCall(sig, func, [ arg ]);
    };
   } else {
    sigCache[func] = function dynCall_wrapper() {
     return Runtime.dynCall(sig, func, Array.prototype.slice.call(arguments));
    };
   }
  }
  return sigCache[func];
 }),
 getCompilerSetting: (function(name) {
  throw "You must build with -s RETAIN_COMPILER_SETTINGS=1 for Runtime.getCompilerSetting or emscripten_get_compiler_setting to work";
 }),
 stackAlloc: (function(size) {
  var ret = STACKTOP;
  STACKTOP = STACKTOP + size | 0;
  STACKTOP = STACKTOP + 15 & -16;
  assert((STACKTOP | 0) < (STACK_MAX | 0) | 0) | 0;
  return ret;
 }),
 staticAlloc: (function(size) {
  var ret = STATICTOP;
  STATICTOP = STATICTOP + (assert(!staticSealed), size) | 0;
  STATICTOP = STATICTOP + 15 & -16;
  return ret;
 }),
 dynamicAlloc: (function(size) {
  assert(DYNAMICTOP_PTR);
  var ret = HEAP32[DYNAMICTOP_PTR >> 2];
  var end = (ret + size + 15 | 0) & -16;
  HEAP32[DYNAMICTOP_PTR >> 2] = end;
  if (end >= TOTAL_MEMORY) {
   var success = enlargeMemory();
   if (!success) {
    HEAP32[DYNAMICTOP_PTR >> 2] = ret;
    return 0;
   }
  }
  return ret;
 }),
 alignMemory: (function(size, quantum) {
  var ret = size = Math.ceil(size / (quantum ? quantum : 16)) * (quantum ? quantum : 16);
  return ret;
 }),
 makeBigInt: (function(low, high, unsigned) {
  var ret = unsigned ? +(low >>> 0) + +(high >>> 0) * +4294967296 : +(low >>> 0) + +(high | 0) * +4294967296;
  return ret;
 }),
 GLOBAL_BASE: 8,
 QUANTUM_SIZE: 4,
 __dummy__: 0
};
Module["Runtime"] = Runtime;
var ABORT = 0;
var EXITSTATUS = 0;
function assert(condition, text) {
 if (!condition) {
  abort("Assertion failed: " + text);
 }
}
function getCFunc(ident) {
 var func = Module["_" + ident];
 if (!func) {
  try {
   func = eval("_" + ident);
  } catch (e) {}
 }
 assert(func, "Cannot call unknown function " + ident + " (perhaps LLVM optimizations or closure removed it?)");
 return func;
}
var cwrap, ccall;
((function() {
 var JSfuncs = {
  "stackSave": (function() {
   Runtime.stackSave();
  }),
  "stackRestore": (function() {
   Runtime.stackRestore();
  }),
  "arrayToC": (function(arr) {
   var ret = Runtime.stackAlloc(arr.length);
   writeArrayToMemory(arr, ret);
   return ret;
  }),
  "stringToC": (function(str) {
   var ret = 0;
   if (str !== null && str !== undefined && str !== 0) {
    var len = (str.length << 2) + 1;
    ret = Runtime.stackAlloc(len);
    stringToUTF8(str, ret, len);
   }
   return ret;
  })
 };
 var toC = {
  "string": JSfuncs["stringToC"],
  "array": JSfuncs["arrayToC"]
 };
 ccall = function ccallFunc(ident, returnType, argTypes, args, opts) {
  var func = getCFunc(ident);
  var cArgs = [];
  var stack = 0;
  assert(returnType !== "array", 'Return type should not be "array".');
  if (args) {
   for (var i = 0; i < args.length; i++) {
    var converter = toC[argTypes[i]];
    if (converter) {
     if (stack === 0) stack = Runtime.stackSave();
     cArgs[i] = converter(args[i]);
    } else {
     cArgs[i] = args[i];
    }
   }
  }
  var ret = func.apply(null, cArgs);
  if ((!opts || !opts.async) && typeof EmterpreterAsync === "object") {
   assert(!EmterpreterAsync.state, "cannot start async op with normal JS calling ccall");
  }
  if (opts && opts.async) assert(!returnType, "async ccalls cannot return values");
  if (returnType === "string") ret = Pointer_stringify(ret);
  if (stack !== 0) {
   if (opts && opts.async) {
    EmterpreterAsync.asyncFinalizers.push((function() {
     Runtime.stackRestore(stack);
    }));
    return;
   }
   Runtime.stackRestore(stack);
  }
  return ret;
 };
 var sourceRegex = /^function\s*[a-zA-Z$_0-9]*\s*\(([^)]*)\)\s*{\s*([^*]*?)[\s;]*(?:return\s*(.*?)[;\s]*)?}$/;
 function parseJSFunc(jsfunc) {
  var parsed = jsfunc.toString().match(sourceRegex).slice(1);
  return {
   arguments: parsed[0],
   body: parsed[1],
   returnValue: parsed[2]
  };
 }
 var JSsource = null;
 function ensureJSsource() {
  if (!JSsource) {
   JSsource = {};
   for (var fun in JSfuncs) {
    if (JSfuncs.hasOwnProperty(fun)) {
     JSsource[fun] = parseJSFunc(JSfuncs[fun]);
    }
   }
  }
 }
 cwrap = function cwrap(ident, returnType, argTypes) {
  argTypes = argTypes || [];
  var cfunc = getCFunc(ident);
  var numericArgs = argTypes.every((function(type) {
   return type === "number";
  }));
  var numericRet = returnType !== "string";
  if (numericRet && numericArgs) {
   return cfunc;
  }
  var argNames = argTypes.map((function(x, i) {
   return "$" + i;
  }));
  var funcstr = "(function(" + argNames.join(",") + ") {";
  var nargs = argTypes.length;
  if (!numericArgs) {
   ensureJSsource();
   funcstr += "var stack = " + JSsource["stackSave"].body + ";";
   for (var i = 0; i < nargs; i++) {
    var arg = argNames[i], type = argTypes[i];
    if (type === "number") continue;
    var convertCode = JSsource[type + "ToC"];
    funcstr += "var " + convertCode.arguments + " = " + arg + ";";
    funcstr += convertCode.body + ";";
    funcstr += arg + "=(" + convertCode.returnValue + ");";
   }
  }
  var cfuncname = parseJSFunc((function() {
   return cfunc;
  })).returnValue;
  funcstr += "var ret = " + cfuncname + "(" + argNames.join(",") + ");";
  if (!numericRet) {
   var strgfy = parseJSFunc((function() {
    return Pointer_stringify;
   })).returnValue;
   funcstr += "ret = " + strgfy + "(ret);";
  }
  funcstr += "if (typeof EmterpreterAsync === 'object') { assert(!EmterpreterAsync.state, 'cannot start async op with normal JS calling cwrap') }";
  if (!numericArgs) {
   ensureJSsource();
   funcstr += JSsource["stackRestore"].body.replace("()", "(stack)") + ";";
  }
  funcstr += "return ret})";
  return eval(funcstr);
 };
}))();
Module["ccall"] = ccall;
Module["cwrap"] = cwrap;
function setValue(ptr, value, type, noSafe) {
 type = type || "i8";
 if (type.charAt(type.length - 1) === "*") type = "i32";
 switch (type) {
 case "i1":
  HEAP8[ptr >> 0] = value;
  break;
 case "i8":
  HEAP8[ptr >> 0] = value;
  break;
 case "i16":
  HEAP16[ptr >> 1] = value;
  break;
 case "i32":
  HEAP32[ptr >> 2] = value;
  break;
 case "i64":
  tempI64 = [ value >>> 0, (tempDouble = value, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0) ], HEAP32[ptr >> 2] = tempI64[0], HEAP32[ptr + 4 >> 2] = tempI64[1];
  break;
 case "float":
  HEAPF32[ptr >> 2] = value;
  break;
 case "double":
  HEAPF64[ptr >> 3] = value;
  break;
 default:
  abort("invalid type for setValue: " + type);
 }
}
Module["setValue"] = setValue;
function getValue(ptr, type, noSafe) {
 type = type || "i8";
 if (type.charAt(type.length - 1) === "*") type = "i32";
 switch (type) {
 case "i1":
  return HEAP8[ptr >> 0];
 case "i8":
  return HEAP8[ptr >> 0];
 case "i16":
  return HEAP16[ptr >> 1];
 case "i32":
  return HEAP32[ptr >> 2];
 case "i64":
  return HEAP32[ptr >> 2];
 case "float":
  return HEAPF32[ptr >> 2];
 case "double":
  return HEAPF64[ptr >> 3];
 default:
  abort("invalid type for setValue: " + type);
 }
 return null;
}
Module["getValue"] = getValue;
var ALLOC_NORMAL = 0;
var ALLOC_STACK = 1;
var ALLOC_STATIC = 2;
var ALLOC_DYNAMIC = 3;
var ALLOC_NONE = 4;
Module["ALLOC_NORMAL"] = ALLOC_NORMAL;
Module["ALLOC_STACK"] = ALLOC_STACK;
Module["ALLOC_STATIC"] = ALLOC_STATIC;
Module["ALLOC_DYNAMIC"] = ALLOC_DYNAMIC;
Module["ALLOC_NONE"] = ALLOC_NONE;
function allocate(slab, types, allocator, ptr) {
 var zeroinit, size;
 if (typeof slab === "number") {
  zeroinit = true;
  size = slab;
 } else {
  zeroinit = false;
  size = slab.length;
 }
 var singleType = typeof types === "string" ? types : null;
 var ret;
 if (allocator == ALLOC_NONE) {
  ret = ptr;
 } else {
  ret = [ typeof _malloc === "function" ? _malloc : Runtime.staticAlloc, Runtime.stackAlloc, Runtime.staticAlloc, Runtime.dynamicAlloc ][allocator === undefined ? ALLOC_STATIC : allocator](Math.max(size, singleType ? 1 : types.length));
 }
 if (zeroinit) {
  var ptr = ret, stop;
  assert((ret & 3) == 0);
  stop = ret + (size & ~3);
  for (; ptr < stop; ptr += 4) {
   HEAP32[ptr >> 2] = 0;
  }
  stop = ret + size;
  while (ptr < stop) {
   HEAP8[ptr++ >> 0] = 0;
  }
  return ret;
 }
 if (singleType === "i8") {
  if (slab.subarray || slab.slice) {
   HEAPU8.set(slab, ret);
  } else {
   HEAPU8.set(new Uint8Array(slab), ret);
  }
  return ret;
 }
 var i = 0, type, typeSize, previousType;
 while (i < size) {
  var curr = slab[i];
  if (typeof curr === "function") {
   curr = Runtime.getFunctionIndex(curr);
  }
  type = singleType || types[i];
  if (type === 0) {
   i++;
   continue;
  }
  assert(type, "Must know what type to store in allocate!");
  if (type == "i64") type = "i32";
  setValue(ret + i, curr, type);
  if (previousType !== type) {
   typeSize = Runtime.getNativeTypeSize(type);
   previousType = type;
  }
  i += typeSize;
 }
 return ret;
}
Module["allocate"] = allocate;
function getMemory(size) {
 if (!staticSealed) return Runtime.staticAlloc(size);
 if (!runtimeInitialized) return Runtime.dynamicAlloc(size);
 return _malloc(size);
}
Module["getMemory"] = getMemory;
function Pointer_stringify(ptr, length) {
 if (length === 0 || !ptr) return "";
 var hasUtf = 0;
 var t;
 var i = 0;
 while (1) {
  assert(ptr + i < TOTAL_MEMORY);
  t = HEAPU8[ptr + i >> 0];
  hasUtf |= t;
  if (t == 0 && !length) break;
  i++;
  if (length && i == length) break;
 }
 if (!length) length = i;
 var ret = "";
 if (hasUtf < 128) {
  var MAX_CHUNK = 1024;
  var curr;
  while (length > 0) {
   curr = String.fromCharCode.apply(String, HEAPU8.subarray(ptr, ptr + Math.min(length, MAX_CHUNK)));
   ret = ret ? ret + curr : curr;
   ptr += MAX_CHUNK;
   length -= MAX_CHUNK;
  }
  return ret;
 }
 return Module["UTF8ToString"](ptr);
}
Module["Pointer_stringify"] = Pointer_stringify;
function AsciiToString(ptr) {
 var str = "";
 while (1) {
  var ch = HEAP8[ptr++ >> 0];
  if (!ch) return str;
  str += String.fromCharCode(ch);
 }
}
Module["AsciiToString"] = AsciiToString;
function stringToAscii(str, outPtr) {
 return writeAsciiToMemory(str, outPtr, false);
}
Module["stringToAscii"] = stringToAscii;
var UTF8Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf8") : undefined;
function UTF8ArrayToString(u8Array, idx) {
 var endPtr = idx;
 while (u8Array[endPtr]) ++endPtr;
 if (endPtr - idx > 16 && u8Array.subarray && UTF8Decoder) {
  return UTF8Decoder.decode(u8Array.subarray(idx, endPtr));
 } else {
  var u0, u1, u2, u3, u4, u5;
  var str = "";
  while (1) {
   u0 = u8Array[idx++];
   if (!u0) return str;
   if (!(u0 & 128)) {
    str += String.fromCharCode(u0);
    continue;
   }
   u1 = u8Array[idx++] & 63;
   if ((u0 & 224) == 192) {
    str += String.fromCharCode((u0 & 31) << 6 | u1);
    continue;
   }
   u2 = u8Array[idx++] & 63;
   if ((u0 & 240) == 224) {
    u0 = (u0 & 15) << 12 | u1 << 6 | u2;
   } else {
    u3 = u8Array[idx++] & 63;
    if ((u0 & 248) == 240) {
     u0 = (u0 & 7) << 18 | u1 << 12 | u2 << 6 | u3;
    } else {
     u4 = u8Array[idx++] & 63;
     if ((u0 & 252) == 248) {
      u0 = (u0 & 3) << 24 | u1 << 18 | u2 << 12 | u3 << 6 | u4;
     } else {
      u5 = u8Array[idx++] & 63;
      u0 = (u0 & 1) << 30 | u1 << 24 | u2 << 18 | u3 << 12 | u4 << 6 | u5;
     }
    }
   }
   if (u0 < 65536) {
    str += String.fromCharCode(u0);
   } else {
    var ch = u0 - 65536;
    str += String.fromCharCode(55296 | ch >> 10, 56320 | ch & 1023);
   }
  }
 }
}
Module["UTF8ArrayToString"] = UTF8ArrayToString;
function UTF8ToString(ptr) {
 return UTF8ArrayToString(HEAPU8, ptr);
}
Module["UTF8ToString"] = UTF8ToString;
function stringToUTF8Array(str, outU8Array, outIdx, maxBytesToWrite) {
 if (!(maxBytesToWrite > 0)) return 0;
 var startIdx = outIdx;
 var endIdx = outIdx + maxBytesToWrite - 1;
 for (var i = 0; i < str.length; ++i) {
  var u = str.charCodeAt(i);
  if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
  if (u <= 127) {
   if (outIdx >= endIdx) break;
   outU8Array[outIdx++] = u;
  } else if (u <= 2047) {
   if (outIdx + 1 >= endIdx) break;
   outU8Array[outIdx++] = 192 | u >> 6;
   outU8Array[outIdx++] = 128 | u & 63;
  } else if (u <= 65535) {
   if (outIdx + 2 >= endIdx) break;
   outU8Array[outIdx++] = 224 | u >> 12;
   outU8Array[outIdx++] = 128 | u >> 6 & 63;
   outU8Array[outIdx++] = 128 | u & 63;
  } else if (u <= 2097151) {
   if (outIdx + 3 >= endIdx) break;
   outU8Array[outIdx++] = 240 | u >> 18;
   outU8Array[outIdx++] = 128 | u >> 12 & 63;
   outU8Array[outIdx++] = 128 | u >> 6 & 63;
   outU8Array[outIdx++] = 128 | u & 63;
  } else if (u <= 67108863) {
   if (outIdx + 4 >= endIdx) break;
   outU8Array[outIdx++] = 248 | u >> 24;
   outU8Array[outIdx++] = 128 | u >> 18 & 63;
   outU8Array[outIdx++] = 128 | u >> 12 & 63;
   outU8Array[outIdx++] = 128 | u >> 6 & 63;
   outU8Array[outIdx++] = 128 | u & 63;
  } else {
   if (outIdx + 5 >= endIdx) break;
   outU8Array[outIdx++] = 252 | u >> 30;
   outU8Array[outIdx++] = 128 | u >> 24 & 63;
   outU8Array[outIdx++] = 128 | u >> 18 & 63;
   outU8Array[outIdx++] = 128 | u >> 12 & 63;
   outU8Array[outIdx++] = 128 | u >> 6 & 63;
   outU8Array[outIdx++] = 128 | u & 63;
  }
 }
 outU8Array[outIdx] = 0;
 return outIdx - startIdx;
}
Module["stringToUTF8Array"] = stringToUTF8Array;
function stringToUTF8(str, outPtr, maxBytesToWrite) {
 assert(typeof maxBytesToWrite == "number", "stringToUTF8(str, outPtr, maxBytesToWrite) is missing the third parameter that specifies the length of the output buffer!");
 return stringToUTF8Array(str, HEAPU8, outPtr, maxBytesToWrite);
}
Module["stringToUTF8"] = stringToUTF8;
function lengthBytesUTF8(str) {
 var len = 0;
 for (var i = 0; i < str.length; ++i) {
  var u = str.charCodeAt(i);
  if (u >= 55296 && u <= 57343) u = 65536 + ((u & 1023) << 10) | str.charCodeAt(++i) & 1023;
  if (u <= 127) {
   ++len;
  } else if (u <= 2047) {
   len += 2;
  } else if (u <= 65535) {
   len += 3;
  } else if (u <= 2097151) {
   len += 4;
  } else if (u <= 67108863) {
   len += 5;
  } else {
   len += 6;
  }
 }
 return len;
}
Module["lengthBytesUTF8"] = lengthBytesUTF8;
var UTF16Decoder = typeof TextDecoder !== "undefined" ? new TextDecoder("utf-16le") : undefined;
function demangle(func) {
 var __cxa_demangle_func = Module["___cxa_demangle"] || Module["__cxa_demangle"];
 if (__cxa_demangle_func) {
  try {
   var s = func.substr(1);
   var len = lengthBytesUTF8(s) + 1;
   var buf = _malloc(len);
   stringToUTF8(s, buf, len);
   var status = _malloc(4);
   var ret = __cxa_demangle_func(buf, 0, 0, status);
   if (getValue(status, "i32") === 0 && ret) {
    return Pointer_stringify(ret);
   }
  } catch (e) {} finally {
   if (buf) _free(buf);
   if (status) _free(status);
   if (ret) _free(ret);
  }
  return func;
 }
 Runtime.warnOnce("warning: build with  -s DEMANGLE_SUPPORT=1  to link in libcxxabi demangling");
 return func;
}
function demangleAll(text) {
 var regex = /__Z[\w\d_]+/g;
 return text.replace(regex, (function(x) {
  var y = demangle(x);
  return x === y ? x : x + " [" + y + "]";
 }));
}
function jsStackTrace() {
 var err = new Error;
 if (!err.stack) {
  try {
   throw new Error(0);
  } catch (e) {
   err = e;
  }
  if (!err.stack) {
   return "(no stack trace available)";
  }
 }
 return err.stack.toString();
}
function stackTrace() {
 var js = jsStackTrace();
 if (Module["extraStackTrace"]) js += "\n" + Module["extraStackTrace"]();
 return demangleAll(js);
}
Module["stackTrace"] = stackTrace;
var PAGE_SIZE = 4096;
var HEAP;
var buffer;
var HEAP8, HEAPU8, HEAP16, HEAPU16, HEAP32, HEAPU32, HEAPF32, HEAPF64;
function updateGlobalBuffer(buf) {
 Module["buffer"] = buffer = buf;
}
function updateGlobalBufferViews() {
 Module["HEAP8"] = HEAP8 = new Int8Array(buffer);
 Module["HEAP16"] = HEAP16 = new Int16Array(buffer);
 Module["HEAP32"] = HEAP32 = new Int32Array(buffer);
 Module["HEAPU8"] = HEAPU8 = new Uint8Array(buffer);
 Module["HEAPU16"] = HEAPU16 = new Uint16Array(buffer);
 Module["HEAPU32"] = HEAPU32 = new Uint32Array(buffer);
 Module["HEAPF32"] = HEAPF32 = new Float32Array(buffer);
 Module["HEAPF64"] = HEAPF64 = new Float64Array(buffer);
}
var STATIC_BASE, STATICTOP, staticSealed;
var STACK_BASE, STACKTOP, STACK_MAX;
var DYNAMIC_BASE, DYNAMICTOP_PTR;
STATIC_BASE = STATICTOP = STACK_BASE = STACKTOP = STACK_MAX = DYNAMIC_BASE = DYNAMICTOP_PTR = 0;
staticSealed = false;
function writeStackCookie() {
 assert((STACK_MAX & 3) == 0);
 HEAPU32[(STACK_MAX >> 2) - 1] = 34821223;
 HEAPU32[(STACK_MAX >> 2) - 2] = 2310721022;
}
function checkStackCookie() {
 if (HEAPU32[(STACK_MAX >> 2) - 1] != 34821223 || HEAPU32[(STACK_MAX >> 2) - 2] != 2310721022) {
  abort("Stack overflow! Stack cookie has been overwritten, expected hex dwords 0x89BACDFE and 0x02135467, but received 0x" + HEAPU32[(STACK_MAX >> 2) - 2].toString(16) + " " + HEAPU32[(STACK_MAX >> 2) - 1].toString(16));
 }
 if (HEAP32[0] !== 1668509029) throw "Runtime error: The application has corrupted its heap memory area (address zero)!";
}
function abortStackOverflow(allocSize) {
 abort("Stack overflow! Attempted to allocate " + allocSize + " bytes on the stack, but stack has only " + (STACK_MAX - asm.stackSave() + allocSize) + " bytes available!");
}
function abortOnCannotGrowMemory() {
 abort("Cannot enlarge memory arrays. Either (1) compile with  -s TOTAL_MEMORY=X  with X higher than the current value " + TOTAL_MEMORY + ", (2) compile with  -s ALLOW_MEMORY_GROWTH=1  which adjusts the size at runtime but prevents some optimizations, (3) set Module.TOTAL_MEMORY to a higher value before the program runs, or if you want malloc to return NULL (0) instead of this abort, compile with  -s ABORTING_MALLOC=0 ");
}
function enlargeMemory() {
 abortOnCannotGrowMemory();
}
var TOTAL_STACK = Module["TOTAL_STACK"] || 5242880;
var TOTAL_MEMORY = Module["TOTAL_MEMORY"] || 536870912;
var WASM_PAGE_SIZE = 64 * 1024;
var totalMemory = WASM_PAGE_SIZE;
while (totalMemory < TOTAL_MEMORY || totalMemory < 2 * TOTAL_STACK) {
 if (totalMemory < 16 * 1024 * 1024) {
  totalMemory *= 2;
 } else {
  totalMemory += 16 * 1024 * 1024;
 }
}
if (totalMemory !== TOTAL_MEMORY) {
 Module.printErr("increasing TOTAL_MEMORY to " + totalMemory + " to be compliant with the asm.js spec (and given that TOTAL_STACK=" + TOTAL_STACK + ")");
 TOTAL_MEMORY = totalMemory;
}
assert(typeof Int32Array !== "undefined" && typeof Float64Array !== "undefined" && !!(new Int32Array(1))["subarray"] && !!(new Int32Array(1))["set"], "JS engine does not provide full typed array support");
if (Module["buffer"]) {
 buffer = Module["buffer"];
 assert(buffer.byteLength === TOTAL_MEMORY, "provided buffer should be " + TOTAL_MEMORY + " bytes, but it is " + buffer.byteLength);
} else {
 {
  buffer = new ArrayBuffer(TOTAL_MEMORY);
 }
 assert(buffer.byteLength === TOTAL_MEMORY);
}
updateGlobalBufferViews();
function getTotalMemory() {
 return TOTAL_MEMORY;
}
HEAP32[0] = 1668509029;
HEAP16[1] = 25459;
if (HEAPU8[2] !== 115 || HEAPU8[3] !== 99) throw "Runtime error: expected the system to be little-endian!";
Module["HEAP"] = HEAP;
Module["buffer"] = buffer;
Module["HEAP8"] = HEAP8;
Module["HEAP16"] = HEAP16;
Module["HEAP32"] = HEAP32;
Module["HEAPU8"] = HEAPU8;
Module["HEAPU16"] = HEAPU16;
Module["HEAPU32"] = HEAPU32;
Module["HEAPF32"] = HEAPF32;
Module["HEAPF64"] = HEAPF64;
function callRuntimeCallbacks(callbacks) {
 while (callbacks.length > 0) {
  var callback = callbacks.shift();
  if (typeof callback == "function") {
   callback();
   continue;
  }
  var func = callback.func;
  if (typeof func === "number") {
   if (callback.arg === undefined) {
    Module["dynCall_v"](func);
   } else {
    Module["dynCall_vi"](func, callback.arg);
   }
  } else {
   func(callback.arg === undefined ? null : callback.arg);
  }
 }
}
var __ATPRERUN__ = [];
var __ATINIT__ = [];
var __ATMAIN__ = [];
var __ATEXIT__ = [];
var __ATPOSTRUN__ = [];
var runtimeInitialized = false;
var runtimeExited = false;
function preRun() {
 if (Module["preRun"]) {
  if (typeof Module["preRun"] == "function") Module["preRun"] = [ Module["preRun"] ];
  while (Module["preRun"].length) {
   addOnPreRun(Module["preRun"].shift());
  }
 }
 callRuntimeCallbacks(__ATPRERUN__);
}
function ensureInitRuntime() {
 checkStackCookie();
 if (runtimeInitialized) return;
 runtimeInitialized = true;
 callRuntimeCallbacks(__ATINIT__);
}
function preMain() {
 checkStackCookie();
 callRuntimeCallbacks(__ATMAIN__);
}
function exitRuntime() {
 checkStackCookie();
 callRuntimeCallbacks(__ATEXIT__);
 runtimeExited = true;
}
function postRun() {
 checkStackCookie();
 if (Module["postRun"]) {
  if (typeof Module["postRun"] == "function") Module["postRun"] = [ Module["postRun"] ];
  while (Module["postRun"].length) {
   addOnPostRun(Module["postRun"].shift());
  }
 }
 callRuntimeCallbacks(__ATPOSTRUN__);
}
function addOnPreRun(cb) {
 __ATPRERUN__.unshift(cb);
}
Module["addOnPreRun"] = addOnPreRun;
function addOnInit(cb) {
 __ATINIT__.unshift(cb);
}
Module["addOnInit"] = addOnInit;
function addOnPreMain(cb) {
 __ATMAIN__.unshift(cb);
}
Module["addOnPreMain"] = addOnPreMain;
function addOnExit(cb) {
 __ATEXIT__.unshift(cb);
}
Module["addOnExit"] = addOnExit;
function addOnPostRun(cb) {
 __ATPOSTRUN__.unshift(cb);
}
Module["addOnPostRun"] = addOnPostRun;
function intArrayFromString(stringy, dontAddNull, length) {
 var len = length > 0 ? length : lengthBytesUTF8(stringy) + 1;
 var u8array = new Array(len);
 var numBytesWritten = stringToUTF8Array(stringy, u8array, 0, u8array.length);
 if (dontAddNull) u8array.length = numBytesWritten;
 return u8array;
}
Module["intArrayFromString"] = intArrayFromString;
function intArrayToString(array) {
 var ret = [];
 for (var i = 0; i < array.length; i++) {
  var chr = array[i];
  if (chr > 255) {
   assert(false, "Character code " + chr + " (" + String.fromCharCode(chr) + ")  at offset " + i + " not in 0x00-0xFF.");
   chr &= 255;
  }
  ret.push(String.fromCharCode(chr));
 }
 return ret.join("");
}
Module["intArrayToString"] = intArrayToString;
function writeStringToMemory(string, buffer, dontAddNull) {
 Runtime.warnOnce("writeStringToMemory is deprecated and should not be called! Use stringToUTF8() instead!");
 var lastChar, end;
 if (dontAddNull) {
  end = buffer + lengthBytesUTF8(string);
  lastChar = HEAP8[end];
 }
 stringToUTF8(string, buffer, Infinity);
 if (dontAddNull) HEAP8[end] = lastChar;
}
Module["writeStringToMemory"] = writeStringToMemory;
function writeArrayToMemory(array, buffer) {
 assert(array.length >= 0, "writeArrayToMemory array must have a length (should be an array or typed array)");
 HEAP8.set(array, buffer);
}
Module["writeArrayToMemory"] = writeArrayToMemory;
function writeAsciiToMemory(str, buffer, dontAddNull) {
 for (var i = 0; i < str.length; ++i) {
  assert(str.charCodeAt(i) === str.charCodeAt(i) & 255);
  HEAP8[buffer++ >> 0] = str.charCodeAt(i);
 }
 if (!dontAddNull) HEAP8[buffer >> 0] = 0;
}
Module["writeAsciiToMemory"] = writeAsciiToMemory;
if (!Math["imul"] || Math["imul"](4294967295, 5) !== -5) Math["imul"] = function imul(a, b) {
 var ah = a >>> 16;
 var al = a & 65535;
 var bh = b >>> 16;
 var bl = b & 65535;
 return al * bl + (ah * bl + al * bh << 16) | 0;
};
Math.imul = Math["imul"];
if (!Math["fround"]) Math["fround"] = (function(x) {
 return x;
});
Math.fround = Math["fround"];
if (!Math["clz32"]) Math["clz32"] = (function(x) {
 x = x >>> 0;
 for (var i = 0; i < 32; i++) {
  if (x & 1 << 31 - i) return i;
 }
 return 32;
});
Math.clz32 = Math["clz32"];
if (!Math["trunc"]) Math["trunc"] = (function(x) {
 return x < 0 ? Math.ceil(x) : Math.floor(x);
});
Math.trunc = Math["trunc"];
var Math_abs = Math.abs;
var Math_cos = Math.cos;
var Math_sin = Math.sin;
var Math_tan = Math.tan;
var Math_acos = Math.acos;
var Math_asin = Math.asin;
var Math_atan = Math.atan;
var Math_atan2 = Math.atan2;
var Math_exp = Math.exp;
var Math_log = Math.log;
var Math_sqrt = Math.sqrt;
var Math_ceil = Math.ceil;
var Math_floor = Math.floor;
var Math_pow = Math.pow;
var Math_imul = Math.imul;
var Math_fround = Math.fround;
var Math_round = Math.round;
var Math_min = Math.min;
var Math_clz32 = Math.clz32;
var Math_trunc = Math.trunc;
var runDependencies = 0;
var runDependencyWatcher = null;
var dependenciesFulfilled = null;
var runDependencyTracking = {};
function getUniqueRunDependency(id) {
 var orig = id;
 while (1) {
  if (!runDependencyTracking[id]) return id;
  id = orig + Math.random();
 }
 return id;
}
function addRunDependency(id) {
 runDependencies++;
 if (Module["monitorRunDependencies"]) {
  Module["monitorRunDependencies"](runDependencies);
 }
 if (id) {
  assert(!runDependencyTracking[id]);
  runDependencyTracking[id] = 1;
  if (runDependencyWatcher === null && typeof setInterval !== "undefined") {
   runDependencyWatcher = setInterval((function() {
    if (ABORT) {
     clearInterval(runDependencyWatcher);
     runDependencyWatcher = null;
     return;
    }
    var shown = false;
    for (var dep in runDependencyTracking) {
     if (!shown) {
      shown = true;
      Module.printErr("still waiting on run dependencies:");
     }
     Module.printErr("dependency: " + dep);
    }
    if (shown) {
     Module.printErr("(end of list)");
    }
   }), 1e4);
  }
 } else {
  Module.printErr("warning: run dependency added without ID");
 }
}
Module["addRunDependency"] = addRunDependency;
function removeRunDependency(id) {
 runDependencies--;
 if (Module["monitorRunDependencies"]) {
  Module["monitorRunDependencies"](runDependencies);
 }
 if (id) {
  assert(runDependencyTracking[id]);
  delete runDependencyTracking[id];
 } else {
  Module.printErr("warning: run dependency removed without ID");
 }
 if (runDependencies == 0) {
  if (runDependencyWatcher !== null) {
   clearInterval(runDependencyWatcher);
   runDependencyWatcher = null;
  }
  if (dependenciesFulfilled) {
   var callback = dependenciesFulfilled;
   dependenciesFulfilled = null;
   callback();
  }
 }
}
Module["removeRunDependency"] = removeRunDependency;
Module["preloadedImages"] = {};
Module["preloadedAudios"] = {};
var memoryInitializer = null;
var ASM_CONSTS = [ (function() {
 Module["emscripten_get_now_backup"] = performance.now;
}), (function($0) {
 {
  performance.now = (function() {
   return $0;
  });
 }
}), (function() {
 performance.now = Module["emscripten_get_now_backup"];
}), (function($0, $1) {
 {
  Module.printErr("bad name in getProcAddress: " + [ Pointer_stringify($0), Pointer_stringify($1) ]);
 }
}) ];
function _emscripten_asm_const_iii(code, a0, a1) {
 return ASM_CONSTS[code](a0, a1);
}
function _emscripten_asm_const_id(code, a0) {
 return ASM_CONSTS[code](a0);
}
function _emscripten_asm_const_v(code) {
 return ASM_CONSTS[code]();
}
STATIC_BASE = 8;
STATICTOP = Runtime.alignMemory(STATIC_BASE, 16) + 2315744;
__ATINIT__.push({
 func: (function() {
  __GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_ai_internal_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_animation_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_animation2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_animation3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_animation_director_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_audio_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_audio2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_video_lump_cpp();
 })
}, {
 func: (function() {
  ___cxx_global_var_init13();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SwCollision_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SwInterCollision_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SwSelfCollision_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SwSolverKernel_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_cloth_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_2d_sorting_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_allocator_lump_cpp();
 })
}, {
 func: (function() {
  ___cxx_global_var_init_2();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_allocator2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_application_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_assetbundles_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_baseclasses_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_baseclasses2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera4_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera_culling_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_core_callbacks_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_gamecode_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_geometry_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_geometry2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_gfxdevice_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics4_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics5_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics6_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_lod_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_input_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_interfaces_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_jobs_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_logging_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_math_random_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_misc_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_misc2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_misc3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_modules_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_mono_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_network_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_preloadmanager_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_profiler_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_profiler_internal_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_scenemanager_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_scripting_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_serialize_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_shaders_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_terrain_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_transform_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_utilities_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_utilities2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_utilities3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_half_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SpriteRendererJobs_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_MemoryManager_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_DirectorManager_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Player_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SaveAndLoadHelper_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_ProfilerImpl_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GlslGpuProgramGLES_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_TransformFeedbackSkinning_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GfxDeviceNull_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_imgui_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_particlesystem_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_SizeByVelocityModule_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_physics2d_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_physics2d2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_PxsFluidDynamics_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_CmEventProfiler_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_dynamics_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_dynamics2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_terrain_lump_cpp_4746();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_terrain2_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_terrainphysics_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_FontImpl_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GUIText_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_TextMeshGenerator_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_ui_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_umbra_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_unityconnect_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_UnityAdsSettings_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_vehicles_lump_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_runtime_video_lump_cpp_5815();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_VRDevice_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_VRGfxHelpers_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_PluginInterfaceVR_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Class_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_MetadataCache_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Runtime_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_File_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Reflection_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_ArrayMetadata_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Thread_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Assembly_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_RCW_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GenericMetadata_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GCHandle_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Socket_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GarbageCollector_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Image_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_StackTrace_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_AppDomain_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Console_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Thread_cpp_62510();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_ThreadImpl_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_LibraryLoader_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_GenericMethod_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_String_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Interlocked_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Assembly_cpp_63068();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_MemoryMappedFile_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Il2CppCodeRegistration_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Environment_cpp();
 })
}, {
 func: (function() {
  __GLOBAL__sub_I_Error_cpp();
 })
});
memoryInitializer = "build.js.mem";
var tempDoublePtr = STATICTOP;
STATICTOP += 16;
assert(tempDoublePtr % 8 == 0);
var GL = {
 counter: 1,
 lastError: 0,
 buffers: [],
 mappedBuffers: {},
 programs: [],
 framebuffers: [],
 renderbuffers: [],
 textures: [],
 uniforms: [],
 shaders: [],
 vaos: [],
 contexts: [],
 currentContext: null,
 offscreenCanvases: {},
 timerQueriesEXT: [],
 queries: [],
 samplers: [],
 transformFeedbacks: [],
 syncs: [],
 byteSizeByTypeRoot: 5120,
 byteSizeByType: [ 1, 1, 2, 2, 4, 4, 4, 2, 3, 4, 8 ],
 programInfos: {},
 stringCache: {},
 stringiCache: {},
 packAlignment: 4,
 unpackAlignment: 4,
 init: (function() {
  GL.miniTempBuffer = new Float32Array(GL.MINI_TEMP_BUFFER_SIZE);
  for (var i = 0; i < GL.MINI_TEMP_BUFFER_SIZE; i++) {
   GL.miniTempBufferViews[i] = GL.miniTempBuffer.subarray(0, i + 1);
  }
 }),
 recordError: function recordError(errorCode) {
  if (!GL.lastError) {
   GL.lastError = errorCode;
  }
 },
 getNewId: (function(table) {
  var ret = GL.counter++;
  for (var i = table.length; i < ret; i++) {
   table[i] = null;
  }
  return ret;
 }),
 MINI_TEMP_BUFFER_SIZE: 256,
 miniTempBuffer: null,
 miniTempBufferViews: [ 0 ],
 getSource: (function(shader, count, string, length) {
  var source = "";
  for (var i = 0; i < count; ++i) {
   var frag;
   if (length) {
    var len = HEAP32[length + i * 4 >> 2];
    if (len < 0) {
     frag = Pointer_stringify(HEAP32[string + i * 4 >> 2]);
    } else {
     frag = Pointer_stringify(HEAP32[string + i * 4 >> 2], len);
    }
   } else {
    frag = Pointer_stringify(HEAP32[string + i * 4 >> 2]);
   }
   source += frag;
  }
  return source;
 }),
 createContext: (function(canvas, webGLContextAttributes) {
  if (typeof webGLContextAttributes["majorVersion"] === "undefined" && typeof webGLContextAttributes["minorVersion"] === "undefined") {
   webGLContextAttributes["majorVersion"] = 2;
   webGLContextAttributes["minorVersion"] = 0;
  }
  var ctx;
  var errorInfo = "?";
  function onContextCreationError(event) {
   errorInfo = event.statusMessage || errorInfo;
  }
  try {
   canvas.addEventListener("webglcontextcreationerror", onContextCreationError, false);
   try {
    if (webGLContextAttributes["majorVersion"] == 1 && webGLContextAttributes["minorVersion"] == 0) {
     ctx = canvas.getContext("webgl", webGLContextAttributes) || canvas.getContext("experimental-webgl", webGLContextAttributes);
    } else if (webGLContextAttributes["majorVersion"] == 2 && webGLContextAttributes["minorVersion"] == 0) {
     ctx = canvas.getContext("webgl2", webGLContextAttributes) || canvas.getContext("experimental-webgl2", webGLContextAttributes);
    } else {
     throw "Unsupported WebGL context version " + majorVersion + "." + minorVersion + "!";
    }
   } finally {
    canvas.removeEventListener("webglcontextcreationerror", onContextCreationError, false);
   }
   if (!ctx) throw ":(";
  } catch (e) {
   Module.print("Could not create canvas: " + [ errorInfo, e, JSON.stringify(webGLContextAttributes) ]);
   return 0;
  }
  if (!ctx) return 0;
  return GL.registerContext(ctx, webGLContextAttributes);
 }),
 registerContext: (function(ctx, webGLContextAttributes) {
  var handle = GL.getNewId(GL.contexts);
  var context = {
   handle: handle,
   attributes: webGLContextAttributes,
   version: webGLContextAttributes["majorVersion"],
   GLctx: ctx
  };
  if (ctx.canvas) ctx.canvas.GLctxObject = context;
  GL.contexts[handle] = context;
  if (typeof webGLContextAttributes["enableExtensionsByDefault"] === "undefined" || webGLContextAttributes["enableExtensionsByDefault"]) {
   GL.initExtensions(context);
  }
  return handle;
 }),
 makeContextCurrent: (function(contextHandle) {
  var context = GL.contexts[contextHandle];
  if (!context) return false;
  GLctx = Module.ctx = context.GLctx;
  GL.currentContext = context;
  return true;
 }),
 getContext: (function(contextHandle) {
  return GL.contexts[contextHandle];
 }),
 deleteContext: (function(contextHandle) {
  if (GL.currentContext === GL.contexts[contextHandle]) GL.currentContext = null;
  if (typeof JSEvents === "object") JSEvents.removeAllHandlersOnTarget(GL.contexts[contextHandle].GLctx.canvas);
  if (GL.contexts[contextHandle] && GL.contexts[contextHandle].GLctx.canvas) GL.contexts[contextHandle].GLctx.canvas.GLctxObject = undefined;
  GL.contexts[contextHandle] = null;
 }),
 initExtensions: (function(context) {
  if (!context) context = GL.currentContext;
  if (context.initExtensionsDone) return;
  context.initExtensionsDone = true;
  var GLctx = context.GLctx;
  context.maxVertexAttribs = GLctx.getParameter(GLctx.MAX_VERTEX_ATTRIBS);
  if (context.version < 2) {
   var instancedArraysExt = GLctx.getExtension("ANGLE_instanced_arrays");
   if (instancedArraysExt) {
    GLctx["vertexAttribDivisor"] = (function(index, divisor) {
     instancedArraysExt["vertexAttribDivisorANGLE"](index, divisor);
    });
    GLctx["drawArraysInstanced"] = (function(mode, first, count, primcount) {
     instancedArraysExt["drawArraysInstancedANGLE"](mode, first, count, primcount);
    });
    GLctx["drawElementsInstanced"] = (function(mode, count, type, indices, primcount) {
     instancedArraysExt["drawElementsInstancedANGLE"](mode, count, type, indices, primcount);
    });
   }
   var vaoExt = GLctx.getExtension("OES_vertex_array_object");
   if (vaoExt) {
    GLctx["createVertexArray"] = (function() {
     return vaoExt["createVertexArrayOES"]();
    });
    GLctx["deleteVertexArray"] = (function(vao) {
     vaoExt["deleteVertexArrayOES"](vao);
    });
    GLctx["bindVertexArray"] = (function(vao) {
     vaoExt["bindVertexArrayOES"](vao);
    });
    GLctx["isVertexArray"] = (function(vao) {
     return vaoExt["isVertexArrayOES"](vao);
    });
   }
   var drawBuffersExt = GLctx.getExtension("WEBGL_draw_buffers");
   if (drawBuffersExt) {
    GLctx["drawBuffers"] = (function(n, bufs) {
     drawBuffersExt["drawBuffersWEBGL"](n, bufs);
    });
   }
  }
  GLctx.disjointTimerQueryExt = GLctx.getExtension("EXT_disjoint_timer_query");
  var automaticallyEnabledExtensions = [ "OES_texture_float", "OES_texture_half_float", "OES_standard_derivatives", "OES_vertex_array_object", "WEBGL_compressed_texture_s3tc", "WEBGL_depth_texture", "OES_element_index_uint", "EXT_texture_filter_anisotropic", "ANGLE_instanced_arrays", "OES_texture_float_linear", "OES_texture_half_float_linear", "WEBGL_compressed_texture_atc", "WEBGL_compressed_texture_pvrtc", "EXT_color_buffer_half_float", "WEBGL_color_buffer_float", "EXT_frag_depth", "EXT_sRGB", "WEBGL_draw_buffers", "WEBGL_shared_resources", "EXT_shader_texture_lod", "EXT_color_buffer_float" ];
  var exts = GLctx.getSupportedExtensions();
  if (exts && exts.length > 0) {
   GLctx.getSupportedExtensions().forEach((function(ext) {
    if (automaticallyEnabledExtensions.indexOf(ext) != -1) {
     GLctx.getExtension(ext);
    }
   }));
  }
 }),
 populateUniformTable: (function(program) {
  var p = GL.programs[program];
  GL.programInfos[program] = {
   uniforms: {},
   maxUniformLength: 0,
   maxAttributeLength: -1,
   maxUniformBlockNameLength: -1
  };
  var ptable = GL.programInfos[program];
  var utable = ptable.uniforms;
  var numUniforms = GLctx.getProgramParameter(p, GLctx.ACTIVE_UNIFORMS);
  for (var i = 0; i < numUniforms; ++i) {
   var u = GLctx.getActiveUniform(p, i);
   var name = u.name;
   ptable.maxUniformLength = Math.max(ptable.maxUniformLength, name.length + 1);
   if (name.indexOf("]", name.length - 1) !== -1) {
    var ls = name.lastIndexOf("[");
    name = name.slice(0, ls);
   }
   var loc = GLctx.getUniformLocation(p, name);
   if (loc != null) {
    var id = GL.getNewId(GL.uniforms);
    utable[name] = [ u.size, id ];
    GL.uniforms[id] = loc;
    for (var j = 1; j < u.size; ++j) {
     var n = name + "[" + j + "]";
     loc = GLctx.getUniformLocation(p, n);
     id = GL.getNewId(GL.uniforms);
     GL.uniforms[id] = loc;
    }
   }
  }
 })
};
function _emscripten_glStencilMaskSeparate(x0, x1) {
 GLctx["stencilMaskSeparate"](x0, x1);
}
function _emscripten_get_now() {
 abort();
}
function _emscripten_set_main_loop(func, fps, simulateInfiniteLoop, arg, noSetTiming) {
 Module["noExitRuntime"] = true;
 assert(!Browser.mainLoop.func, "emscripten_set_main_loop: there can only be one main loop function at once: call emscripten_cancel_main_loop to cancel the previous one before setting a new one with different parameters.");
 Browser.mainLoop.func = func;
 Browser.mainLoop.arg = arg;
 var browserIterationFunc;
 if (typeof arg !== "undefined") {
  browserIterationFunc = (function() {
   Module["dynCall_vi"](func, arg);
  });
 } else {
  browserIterationFunc = (function() {
   Module["dynCall_v"](func);
  });
 }
 var thisMainLoopId = Browser.mainLoop.currentlyRunningMainloop;
 Browser.mainLoop.runner = function Browser_mainLoop_runner() {
  if (ABORT) return;
  if (Browser.mainLoop.queue.length > 0) {
   var start = Date.now();
   var blocker = Browser.mainLoop.queue.shift();
   blocker.func(blocker.arg);
   if (Browser.mainLoop.remainingBlockers) {
    var remaining = Browser.mainLoop.remainingBlockers;
    var next = remaining % 1 == 0 ? remaining - 1 : Math.floor(remaining);
    if (blocker.counted) {
     Browser.mainLoop.remainingBlockers = next;
    } else {
     next = next + .5;
     Browser.mainLoop.remainingBlockers = (8 * remaining + next) / 9;
    }
   }
   console.log('main loop blocker "' + blocker.name + '" took ' + (Date.now() - start) + " ms");
   Browser.mainLoop.updateStatus();
   if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
   setTimeout(Browser.mainLoop.runner, 0);
   return;
  }
  if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
  Browser.mainLoop.currentFrameNumber = Browser.mainLoop.currentFrameNumber + 1 | 0;
  if (Browser.mainLoop.timingMode == 1 && Browser.mainLoop.timingValue > 1 && Browser.mainLoop.currentFrameNumber % Browser.mainLoop.timingValue != 0) {
   Browser.mainLoop.scheduler();
   return;
  } else if (Browser.mainLoop.timingMode == 0) {
   Browser.mainLoop.tickStartTime = _emscripten_get_now();
  }
  if (Browser.mainLoop.method === "timeout" && Module.ctx) {
   Module.printErr("Looks like you are rendering without using requestAnimationFrame for the main loop. You should use 0 for the frame rate in emscripten_set_main_loop in order to use requestAnimationFrame, as that can greatly improve your frame rates!");
   Browser.mainLoop.method = "";
  }
  Browser.mainLoop.runIter(browserIterationFunc);
  checkStackCookie();
  if (thisMainLoopId < Browser.mainLoop.currentlyRunningMainloop) return;
  if (typeof SDL === "object" && SDL.audio && SDL.audio.queueNewAudioData) SDL.audio.queueNewAudioData();
  Browser.mainLoop.scheduler();
 };
 if (!noSetTiming) {
  if (fps && fps > 0) _emscripten_set_main_loop_timing(0, 1e3 / fps); else _emscripten_set_main_loop_timing(1, 1);
  Browser.mainLoop.scheduler();
 }
 if (simulateInfiniteLoop) {
  throw "SimulateInfiniteLoop";
 }
}
var Browser = {
 mainLoop: {
  scheduler: null,
  method: "",
  currentlyRunningMainloop: 0,
  func: null,
  arg: 0,
  timingMode: 0,
  timingValue: 0,
  currentFrameNumber: 0,
  queue: [],
  pause: (function() {
   Browser.mainLoop.scheduler = null;
   Browser.mainLoop.currentlyRunningMainloop++;
  }),
  resume: (function() {
   Browser.mainLoop.currentlyRunningMainloop++;
   var timingMode = Browser.mainLoop.timingMode;
   var timingValue = Browser.mainLoop.timingValue;
   var func = Browser.mainLoop.func;
   Browser.mainLoop.func = null;
   _emscripten_set_main_loop(func, 0, false, Browser.mainLoop.arg, true);
   _emscripten_set_main_loop_timing(timingMode, timingValue);
   Browser.mainLoop.scheduler();
  }),
  updateStatus: (function() {
   if (Module["setStatus"]) {
    var message = Module["statusMessage"] || "Please wait...";
    var remaining = Browser.mainLoop.remainingBlockers;
    var expected = Browser.mainLoop.expectedBlockers;
    if (remaining) {
     if (remaining < expected) {
      Module["setStatus"](message + " (" + (expected - remaining) + "/" + expected + ")");
     } else {
      Module["setStatus"](message);
     }
    } else {
     Module["setStatus"]("");
    }
   }
  }),
  runIter: (function(func) {
   if (ABORT) return;
   if (Module["preMainLoop"]) {
    var preRet = Module["preMainLoop"]();
    if (preRet === false) {
     return;
    }
   }
   try {
    func();
   } catch (e) {
    if (e instanceof ExitStatus) {
     return;
    } else {
     if (e && typeof e === "object" && e.stack) Module.printErr("exception thrown: " + [ e, e.stack ]);
     throw e;
    }
   }
   if (Module["postMainLoop"]) Module["postMainLoop"]();
  })
 },
 isFullscreen: false,
 pointerLock: false,
 moduleContextCreatedCallbacks: [],
 workers: [],
 init: (function() {
  if (!Module["preloadPlugins"]) Module["preloadPlugins"] = [];
  if (Browser.initted) return;
  Browser.initted = true;
  try {
   new Blob;
   Browser.hasBlobConstructor = true;
  } catch (e) {
   Browser.hasBlobConstructor = false;
   console.log("warning: no blob constructor, cannot create blobs with mimetypes");
  }
  Browser.BlobBuilder = typeof MozBlobBuilder != "undefined" ? MozBlobBuilder : typeof WebKitBlobBuilder != "undefined" ? WebKitBlobBuilder : !Browser.hasBlobConstructor ? console.log("warning: no BlobBuilder") : null;
  Browser.URLObject = typeof window != "undefined" ? window.URL ? window.URL : window.webkitURL : undefined;
  if (!Module.noImageDecoding && typeof Browser.URLObject === "undefined") {
   console.log("warning: Browser does not support creating object URLs. Built-in browser image decoding will not be available.");
   Module.noImageDecoding = true;
  }
  var imagePlugin = {};
  imagePlugin["canHandle"] = function imagePlugin_canHandle(name) {
   return !Module.noImageDecoding && /\.(jpg|jpeg|png|bmp)$/i.test(name);
  };
  imagePlugin["handle"] = function imagePlugin_handle(byteArray, name, onload, onerror) {
   var b = null;
   if (Browser.hasBlobConstructor) {
    try {
     b = new Blob([ byteArray ], {
      type: Browser.getMimetype(name)
     });
     if (b.size !== byteArray.length) {
      b = new Blob([ (new Uint8Array(byteArray)).buffer ], {
       type: Browser.getMimetype(name)
      });
     }
    } catch (e) {
     Runtime.warnOnce("Blob constructor present but fails: " + e + "; falling back to blob builder");
    }
   }
   if (!b) {
    var bb = new Browser.BlobBuilder;
    bb.append((new Uint8Array(byteArray)).buffer);
    b = bb.getBlob();
   }
   var url = Browser.URLObject.createObjectURL(b);
   assert(typeof url == "string", "createObjectURL must return a url as a string");
   var img = new Image;
   img.onload = function img_onload() {
    assert(img.complete, "Image " + name + " could not be decoded");
    var canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    var ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0);
    Module["preloadedImages"][name] = canvas;
    Browser.URLObject.revokeObjectURL(url);
    if (onload) onload(byteArray);
   };
   img.onerror = function img_onerror(event) {
    console.log("Image " + url + " could not be decoded");
    if (onerror) onerror();
   };
   img.src = url;
  };
  Module["preloadPlugins"].push(imagePlugin);
  var audioPlugin = {};
  audioPlugin["canHandle"] = function audioPlugin_canHandle(name) {
   return !Module.noAudioDecoding && name.substr(-4) in {
    ".ogg": 1,
    ".wav": 1,
    ".mp3": 1
   };
  };
  audioPlugin["handle"] = function audioPlugin_handle(byteArray, name, onload, onerror) {
   var done = false;
   function finish(audio) {
    if (done) return;
    done = true;
    Module["preloadedAudios"][name] = audio;
    if (onload) onload(byteArray);
   }
   function fail() {
    if (done) return;
    done = true;
    Module["preloadedAudios"][name] = new Audio;
    if (onerror) onerror();
   }
   if (Browser.hasBlobConstructor) {
    try {
     var b = new Blob([ byteArray ], {
      type: Browser.getMimetype(name)
     });
    } catch (e) {
     return fail();
    }
    var url = Browser.URLObject.createObjectURL(b);
    assert(typeof url == "string", "createObjectURL must return a url as a string");
    var audio = new Audio;
    audio.addEventListener("canplaythrough", (function() {
     finish(audio);
    }), false);
    audio.onerror = function audio_onerror(event) {
     if (done) return;
     console.log("warning: browser could not fully decode audio " + name + ", trying slower base64 approach");
     function encode64(data) {
      var BASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      var PAD = "=";
      var ret = "";
      var leftchar = 0;
      var leftbits = 0;
      for (var i = 0; i < data.length; i++) {
       leftchar = leftchar << 8 | data[i];
       leftbits += 8;
       while (leftbits >= 6) {
        var curr = leftchar >> leftbits - 6 & 63;
        leftbits -= 6;
        ret += BASE[curr];
       }
      }
      if (leftbits == 2) {
       ret += BASE[(leftchar & 3) << 4];
       ret += PAD + PAD;
      } else if (leftbits == 4) {
       ret += BASE[(leftchar & 15) << 2];
       ret += PAD;
      }
      return ret;
     }
     audio.src = "data:audio/x-" + name.substr(-3) + ";base64," + encode64(byteArray);
     finish(audio);
    };
    audio.src = url;
    Browser.safeSetTimeout((function() {
     finish(audio);
    }), 1e4);
   } else {
    return fail();
   }
  };
  Module["preloadPlugins"].push(audioPlugin);
  var canvas = Module["canvas"];
  function pointerLockChange() {
   Browser.pointerLock = document["pointerLockElement"] === canvas || document["mozPointerLockElement"] === canvas || document["webkitPointerLockElement"] === canvas || document["msPointerLockElement"] === canvas;
  }
  if (canvas) {
   canvas.requestPointerLock = canvas["requestPointerLock"] || canvas["mozRequestPointerLock"] || canvas["webkitRequestPointerLock"] || canvas["msRequestPointerLock"] || (function() {});
   canvas.exitPointerLock = document["exitPointerLock"] || document["mozExitPointerLock"] || document["webkitExitPointerLock"] || document["msExitPointerLock"] || (function() {});
   canvas.exitPointerLock = canvas.exitPointerLock.bind(document);
   document.addEventListener("pointerlockchange", pointerLockChange, false);
   document.addEventListener("mozpointerlockchange", pointerLockChange, false);
   document.addEventListener("webkitpointerlockchange", pointerLockChange, false);
   document.addEventListener("mspointerlockchange", pointerLockChange, false);
   if (Module["elementPointerLock"]) {
    canvas.addEventListener("click", (function(ev) {
     if (!Browser.pointerLock && canvas.requestPointerLock) {
      canvas.requestPointerLock();
      ev.preventDefault();
     }
    }), false);
   }
  }
 }),
 createContext: (function(canvas, useWebGL, setInModule, webGLContextAttributes) {
  if (useWebGL && Module.ctx && canvas == Module.canvas) return Module.ctx;
  var ctx;
  var contextHandle;
  if (useWebGL) {
   var contextAttributes = {
    antialias: false,
    alpha: false
   };
   if (webGLContextAttributes) {
    for (var attribute in webGLContextAttributes) {
     contextAttributes[attribute] = webGLContextAttributes[attribute];
    }
   }
   contextHandle = GL.createContext(canvas, contextAttributes);
   if (contextHandle) {
    ctx = GL.getContext(contextHandle).GLctx;
   }
  } else {
   ctx = canvas.getContext("2d");
  }
  if (!ctx) return null;
  if (setInModule) {
   if (!useWebGL) assert(typeof GLctx === "undefined", "cannot set in module if GLctx is used, but we are a non-GL context that would replace it");
   Module.ctx = ctx;
   if (useWebGL) GL.makeContextCurrent(contextHandle);
   Module.useWebGL = useWebGL;
   Browser.moduleContextCreatedCallbacks.forEach((function(callback) {
    callback();
   }));
   Browser.init();
  }
  return ctx;
 }),
 destroyContext: (function(canvas, useWebGL, setInModule) {}),
 fullscreenHandlersInstalled: false,
 lockPointer: undefined,
 resizeCanvas: undefined,
 requestFullscreen: (function(lockPointer, resizeCanvas, vrDevice) {
  Browser.lockPointer = lockPointer;
  Browser.resizeCanvas = resizeCanvas;
  Browser.vrDevice = vrDevice;
  if (typeof Browser.lockPointer === "undefined") Browser.lockPointer = true;
  if (typeof Browser.resizeCanvas === "undefined") Browser.resizeCanvas = false;
  if (typeof Browser.vrDevice === "undefined") Browser.vrDevice = null;
  var canvas = Module["canvas"];
  function fullscreenChange() {
   Browser.isFullscreen = false;
   var canvasContainer = canvas.parentNode;
   if ((document["fullscreenElement"] || document["mozFullScreenElement"] || document["msFullscreenElement"] || document["webkitFullscreenElement"] || document["webkitCurrentFullScreenElement"]) === canvasContainer) {
    canvas.exitFullscreen = document["exitFullscreen"] || document["cancelFullScreen"] || document["mozCancelFullScreen"] || document["msExitFullscreen"] || document["webkitCancelFullScreen"] || (function() {});
    canvas.exitFullscreen = canvas.exitFullscreen.bind(document);
    if (Browser.lockPointer) canvas.requestPointerLock();
    Browser.isFullscreen = true;
    if (Browser.resizeCanvas) Browser.setFullscreenCanvasSize();
   } else {
    canvasContainer.parentNode.insertBefore(canvas, canvasContainer);
    canvasContainer.parentNode.removeChild(canvasContainer);
    if (Browser.resizeCanvas) Browser.setWindowedCanvasSize();
   }
   if (Module["onFullScreen"]) Module["onFullScreen"](Browser.isFullscreen);
   if (Module["onFullscreen"]) Module["onFullscreen"](Browser.isFullscreen);
   Browser.updateCanvasDimensions(canvas);
  }
  if (!Browser.fullscreenHandlersInstalled) {
   Browser.fullscreenHandlersInstalled = true;
   document.addEventListener("fullscreenchange", fullscreenChange, false);
   document.addEventListener("mozfullscreenchange", fullscreenChange, false);
   document.addEventListener("webkitfullscreenchange", fullscreenChange, false);
   document.addEventListener("MSFullscreenChange", fullscreenChange, false);
  }
  var canvasContainer = document.createElement("div");
  canvas.parentNode.insertBefore(canvasContainer, canvas);
  canvasContainer.appendChild(canvas);
  canvasContainer.requestFullscreen = canvasContainer["requestFullscreen"] || canvasContainer["mozRequestFullScreen"] || canvasContainer["msRequestFullscreen"] || (canvasContainer["webkitRequestFullscreen"] ? (function() {
   canvasContainer["webkitRequestFullscreen"](Element["ALLOW_KEYBOARD_INPUT"]);
  }) : null) || (canvasContainer["webkitRequestFullScreen"] ? (function() {
   canvasContainer["webkitRequestFullScreen"](Element["ALLOW_KEYBOARD_INPUT"]);
  }) : null);
  if (vrDevice) {
   canvasContainer.requestFullscreen({
    vrDisplay: vrDevice
   });
  } else {
   canvasContainer.requestFullscreen();
  }
 }),
 requestFullScreen: (function(lockPointer, resizeCanvas, vrDevice) {
  Module.printErr("Browser.requestFullScreen() is deprecated. Please call Browser.requestFullscreen instead.");
  Browser.requestFullScreen = (function(lockPointer, resizeCanvas, vrDevice) {
   return Browser.requestFullscreen(lockPointer, resizeCanvas, vrDevice);
  });
  return Browser.requestFullscreen(lockPointer, resizeCanvas, vrDevice);
 }),
 nextRAF: 0,
 fakeRequestAnimationFrame: (function(func) {
  var now = Date.now();
  if (Browser.nextRAF === 0) {
   Browser.nextRAF = now + 1e3 / 60;
  } else {
   while (now + 2 >= Browser.nextRAF) {
    Browser.nextRAF += 1e3 / 60;
   }
  }
  var delay = Math.max(Browser.nextRAF - now, 0);
  setTimeout(func, delay);
 }),
 requestAnimationFrame: function requestAnimationFrame(func) {
  if (typeof window === "undefined") {
   Browser.fakeRequestAnimationFrame(func);
  } else {
   if (!window.requestAnimationFrame) {
    window.requestAnimationFrame = window["requestAnimationFrame"] || window["mozRequestAnimationFrame"] || window["webkitRequestAnimationFrame"] || window["msRequestAnimationFrame"] || window["oRequestAnimationFrame"] || Browser.fakeRequestAnimationFrame;
   }
   window.requestAnimationFrame(func);
  }
 },
 safeCallback: (function(func) {
  return (function() {
   if (!ABORT) return func.apply(null, arguments);
  });
 }),
 allowAsyncCallbacks: true,
 queuedAsyncCallbacks: [],
 pauseAsyncCallbacks: (function() {
  Browser.allowAsyncCallbacks = false;
 }),
 resumeAsyncCallbacks: (function() {
  Browser.allowAsyncCallbacks = true;
  if (Browser.queuedAsyncCallbacks.length > 0) {
   var callbacks = Browser.queuedAsyncCallbacks;
   Browser.queuedAsyncCallbacks = [];
   callbacks.forEach((function(func) {
    func();
   }));
  }
 }),
 safeRequestAnimationFrame: (function(func) {
  return Browser.requestAnimationFrame((function() {
   if (ABORT) return;
   if (Browser.allowAsyncCallbacks) {
    func();
   } else {
    Browser.queuedAsyncCallbacks.push(func);
   }
  }));
 }),
 safeSetTimeout: (function(func, timeout) {
  Module["noExitRuntime"] = true;
  return setTimeout((function() {
   if (ABORT) return;
   if (Browser.allowAsyncCallbacks) {
    func();
   } else {
    Browser.queuedAsyncCallbacks.push(func);
   }
  }), timeout);
 }),
 safeSetInterval: (function(func, timeout) {
  Module["noExitRuntime"] = true;
  return setInterval((function() {
   if (ABORT) return;
   if (Browser.allowAsyncCallbacks) {
    func();
   }
  }), timeout);
 }),
 getMimetype: (function(name) {
  return {
   "jpg": "image/jpeg",
   "jpeg": "image/jpeg",
   "png": "image/png",
   "bmp": "image/bmp",
   "ogg": "audio/ogg",
   "wav": "audio/wav",
   "mp3": "audio/mpeg"
  }[name.substr(name.lastIndexOf(".") + 1)];
 }),
 getUserMedia: (function(func) {
  if (!window.getUserMedia) {
   window.getUserMedia = navigator["getUserMedia"] || navigator["mozGetUserMedia"];
  }
  window.getUserMedia(func);
 }),
 getMovementX: (function(event) {
  return event["movementX"] || event["mozMovementX"] || event["webkitMovementX"] || 0;
 }),
 getMovementY: (function(event) {
  return event["movementY"] || event["mozMovementY"] || event["webkitMovementY"] || 0;
 }),
 getMouseWheelDelta: (function(event) {
  var delta = 0;
  switch (event.type) {
  case "DOMMouseScroll":
   delta = event.detail;
   break;
  case "mousewheel":
   delta = event.wheelDelta;
   break;
  case "wheel":
   delta = event["deltaY"];
   break;
  default:
   throw "unrecognized mouse wheel event: " + event.type;
  }
  return delta;
 }),
 mouseX: 0,
 mouseY: 0,
 mouseMovementX: 0,
 mouseMovementY: 0,
 touches: {},
 lastTouches: {},
 calculateMouseEvent: (function(event) {
  if (Browser.pointerLock) {
   if (event.type != "mousemove" && "mozMovementX" in event) {
    Browser.mouseMovementX = Browser.mouseMovementY = 0;
   } else {
    Browser.mouseMovementX = Browser.getMovementX(event);
    Browser.mouseMovementY = Browser.getMovementY(event);
   }
   if (typeof SDL != "undefined") {
    Browser.mouseX = SDL.mouseX + Browser.mouseMovementX;
    Browser.mouseY = SDL.mouseY + Browser.mouseMovementY;
   } else {
    Browser.mouseX += Browser.mouseMovementX;
    Browser.mouseY += Browser.mouseMovementY;
   }
  } else {
   var rect = Module["canvas"].getBoundingClientRect();
   var cw = Module["canvas"].width;
   var ch = Module["canvas"].height;
   var scrollX = typeof window.scrollX !== "undefined" ? window.scrollX : window.pageXOffset;
   var scrollY = typeof window.scrollY !== "undefined" ? window.scrollY : window.pageYOffset;
   assert(typeof scrollX !== "undefined" && typeof scrollY !== "undefined", "Unable to retrieve scroll position, mouse positions likely broken.");
   if (event.type === "touchstart" || event.type === "touchend" || event.type === "touchmove") {
    var touch = event.touch;
    if (touch === undefined) {
     return;
    }
    var adjustedX = touch.pageX - (scrollX + rect.left);
    var adjustedY = touch.pageY - (scrollY + rect.top);
    adjustedX = adjustedX * (cw / rect.width);
    adjustedY = adjustedY * (ch / rect.height);
    var coords = {
     x: adjustedX,
     y: adjustedY
    };
    if (event.type === "touchstart") {
     Browser.lastTouches[touch.identifier] = coords;
     Browser.touches[touch.identifier] = coords;
    } else if (event.type === "touchend" || event.type === "touchmove") {
     var last = Browser.touches[touch.identifier];
     if (!last) last = coords;
     Browser.lastTouches[touch.identifier] = last;
     Browser.touches[touch.identifier] = coords;
    }
    return;
   }
   var x = event.pageX - (scrollX + rect.left);
   var y = event.pageY - (scrollY + rect.top);
   x = x * (cw / rect.width);
   y = y * (ch / rect.height);
   Browser.mouseMovementX = x - Browser.mouseX;
   Browser.mouseMovementY = y - Browser.mouseY;
   Browser.mouseX = x;
   Browser.mouseY = y;
  }
 }),
 asyncLoad: (function(url, onload, onerror, noRunDep) {
  var dep = !noRunDep ? getUniqueRunDependency("al " + url) : "";
  Module["readAsync"](url, (function(arrayBuffer) {
   assert(arrayBuffer, 'Loading data file "' + url + '" failed (no arrayBuffer).');
   onload(new Uint8Array(arrayBuffer));
   if (dep) removeRunDependency(dep);
  }), (function(event) {
   if (onerror) {
    onerror();
   } else {
    throw 'Loading data file "' + url + '" failed.';
   }
  }));
  if (dep) addRunDependency(dep);
 }),
 resizeListeners: [],
 updateResizeListeners: (function() {
  var canvas = Module["canvas"];
  Browser.resizeListeners.forEach((function(listener) {
   listener(canvas.width, canvas.height);
  }));
 }),
 setCanvasSize: (function(width, height, noUpdates) {
  var canvas = Module["canvas"];
  Browser.updateCanvasDimensions(canvas, width, height);
  if (!noUpdates) Browser.updateResizeListeners();
 }),
 windowedWidth: 0,
 windowedHeight: 0,
 setFullscreenCanvasSize: (function() {
  if (typeof SDL != "undefined") {
   var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
   flags = flags | 8388608;
   HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
  }
  Browser.updateResizeListeners();
 }),
 setWindowedCanvasSize: (function() {
  if (typeof SDL != "undefined") {
   var flags = HEAPU32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2];
   flags = flags & ~8388608;
   HEAP32[SDL.screen + Runtime.QUANTUM_SIZE * 0 >> 2] = flags;
  }
  Browser.updateResizeListeners();
 }),
 updateCanvasDimensions: (function(canvas, wNative, hNative) {
  if (wNative && hNative) {
   canvas.widthNative = wNative;
   canvas.heightNative = hNative;
  } else {
   wNative = canvas.widthNative;
   hNative = canvas.heightNative;
  }
  var w = wNative;
  var h = hNative;
  if (Module["forcedAspectRatio"] && Module["forcedAspectRatio"] > 0) {
   if (w / h < Module["forcedAspectRatio"]) {
    w = Math.round(h * Module["forcedAspectRatio"]);
   } else {
    h = Math.round(w / Module["forcedAspectRatio"]);
   }
  }
  if ((document["fullscreenElement"] || document["mozFullScreenElement"] || document["msFullscreenElement"] || document["webkitFullscreenElement"] || document["webkitCurrentFullScreenElement"]) === canvas.parentNode && typeof screen != "undefined") {
   var factor = Math.min(screen.width / w, screen.height / h);
   w = Math.round(w * factor);
   h = Math.round(h * factor);
  }
  if (Browser.resizeCanvas) {
   if (canvas.width != w) canvas.width = w;
   if (canvas.height != h) canvas.height = h;
   if (typeof canvas.style != "undefined") {
    canvas.style.removeProperty("width");
    canvas.style.removeProperty("height");
   }
  } else {
   if (canvas.width != wNative) canvas.width = wNative;
   if (canvas.height != hNative) canvas.height = hNative;
   if (typeof canvas.style != "undefined") {
    if (w != wNative || h != hNative) {
     canvas.style.setProperty("width", w + "px", "important");
     canvas.style.setProperty("height", h + "px", "important");
    } else {
     canvas.style.removeProperty("width");
     canvas.style.removeProperty("height");
    }
   }
  }
 }),
 wgetRequests: {},
 nextWgetRequestHandle: 0,
 getNextWgetRequestHandle: (function() {
  var handle = Browser.nextWgetRequestHandle;
  Browser.nextWgetRequestHandle++;
  return handle;
 })
};
function _emscripten_set_main_loop_timing(mode, value) {
 Browser.mainLoop.timingMode = mode;
 Browser.mainLoop.timingValue = value;
 if (!Browser.mainLoop.func) {
  console.error("emscripten_set_main_loop_timing: Cannot set timing mode for main loop since a main loop does not exist! Call emscripten_set_main_loop first to set one up.");
  return 1;
 }
 if (mode == 0) {
  Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_setTimeout() {
   var timeUntilNextTick = Math.max(0, Browser.mainLoop.tickStartTime + value - _emscripten_get_now()) | 0;
   setTimeout(Browser.mainLoop.runner, timeUntilNextTick);
  };
  Browser.mainLoop.method = "timeout";
 } else if (mode == 1) {
  Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_rAF() {
   Browser.requestAnimationFrame(Browser.mainLoop.runner);
  };
  Browser.mainLoop.method = "rAF";
 } else if (mode == 2) {
  if (!window["setImmediate"]) {
   var setImmediates = [];
   var emscriptenMainLoopMessageId = "setimmediate";
   function Browser_setImmediate_messageHandler(event) {
    if (event.source === window && event.data === emscriptenMainLoopMessageId) {
     event.stopPropagation();
     setImmediates.shift()();
    }
   }
   window.addEventListener("message", Browser_setImmediate_messageHandler, true);
   window["setImmediate"] = function Browser_emulated_setImmediate(func) {
    setImmediates.push(func);
    if (ENVIRONMENT_IS_WORKER) {
     if (Module["setImmediates"] === undefined) Module["setImmediates"] = [];
     Module["setImmediates"].push(func);
     window.postMessage({
      target: emscriptenMainLoopMessageId
     });
    } else window.postMessage(emscriptenMainLoopMessageId, "*");
   };
  }
  Browser.mainLoop.scheduler = function Browser_mainLoop_scheduler_setImmediate() {
   window["setImmediate"](Browser.mainLoop.runner);
  };
  Browser.mainLoop.method = "immediate";
 }
 return 0;
}
function __inet_pton4_raw(str) {
 var b = str.split(".");
 for (var i = 0; i < 4; i++) {
  var tmp = Number(b[i]);
  if (isNaN(tmp)) return null;
  b[i] = tmp;
 }
 return (b[0] | b[1] << 8 | b[2] << 16 | b[3] << 24) >>> 0;
}
function _inet_addr(ptr) {
 var addr = __inet_pton4_raw(Pointer_stringify(ptr));
 if (addr === null) {
  return -1;
 }
 return addr;
}
Module["_pthread_mutex_lock"] = _pthread_mutex_lock;
function _free() {}
Module["_free"] = _free;
function ___cxa_free_exception(ptr) {
 try {
  return _free(ptr);
 } catch (e) {
  Module.printErr("exception during cxa_free_exception: " + e);
 }
}
var EXCEPTIONS = {
 last: 0,
 caught: [],
 infos: {},
 deAdjust: (function(adjusted) {
  if (!adjusted || EXCEPTIONS.infos[adjusted]) return adjusted;
  for (var ptr in EXCEPTIONS.infos) {
   var info = EXCEPTIONS.infos[ptr];
   if (info.adjusted === adjusted) {
    return ptr;
   }
  }
  return adjusted;
 }),
 addRef: (function(ptr) {
  if (!ptr) return;
  var info = EXCEPTIONS.infos[ptr];
  info.refcount++;
 }),
 decRef: (function(ptr) {
  if (!ptr) return;
  var info = EXCEPTIONS.infos[ptr];
  assert(info.refcount > 0);
  info.refcount--;
  if (info.refcount === 0 && !info.rethrown) {
   if (info.destructor) {
    Module["dynCall_vi"](info.destructor, ptr);
   }
   delete EXCEPTIONS.infos[ptr];
   ___cxa_free_exception(ptr);
  }
 }),
 clearRef: (function(ptr) {
  if (!ptr) return;
  var info = EXCEPTIONS.infos[ptr];
  info.refcount = 0;
 })
};
function ___cxa_end_catch() {
 asm["setThrew"](0);
 var ptr = EXCEPTIONS.caught.pop();
 if (ptr) {
  EXCEPTIONS.decRef(EXCEPTIONS.deAdjust(ptr));
  EXCEPTIONS.last = 0;
 }
}
function _emscripten_glStencilFunc(x0, x1, x2) {
 GLctx["stencilFunc"](x0, x1, x2);
}
var JSEvents = {
 keyEvent: 0,
 mouseEvent: 0,
 wheelEvent: 0,
 uiEvent: 0,
 focusEvent: 0,
 deviceOrientationEvent: 0,
 deviceMotionEvent: 0,
 fullscreenChangeEvent: 0,
 pointerlockChangeEvent: 0,
 visibilityChangeEvent: 0,
 touchEvent: 0,
 lastGamepadState: null,
 lastGamepadStateFrame: null,
 previousFullscreenElement: null,
 previousScreenX: null,
 previousScreenY: null,
 removeEventListenersRegistered: false,
 registerRemoveEventListeners: (function() {
  if (!JSEvents.removeEventListenersRegistered) {
   __ATEXIT__.push((function() {
    for (var i = JSEvents.eventHandlers.length - 1; i >= 0; --i) {
     JSEvents._removeHandler(i);
    }
   }));
   JSEvents.removeEventListenersRegistered = true;
  }
 }),
 findEventTarget: (function(target) {
  if (target) {
   if (typeof target == "number") {
    target = Pointer_stringify(target);
   }
   if (target == "#window") return window; else if (target == "#document") return document; else if (target == "#screen") return window.screen; else if (target == "#canvas") return Module["canvas"];
   if (typeof target == "string") return document.getElementById(target); else return target;
  } else {
   return window;
  }
 }),
 deferredCalls: [],
 deferCall: (function(targetFunction, precedence, argsList) {
  function arraysHaveEqualContent(arrA, arrB) {
   if (arrA.length != arrB.length) return false;
   for (var i in arrA) {
    if (arrA[i] != arrB[i]) return false;
   }
   return true;
  }
  for (var i in JSEvents.deferredCalls) {
   var call = JSEvents.deferredCalls[i];
   if (call.targetFunction == targetFunction && arraysHaveEqualContent(call.argsList, argsList)) {
    return;
   }
  }
  JSEvents.deferredCalls.push({
   targetFunction: targetFunction,
   precedence: precedence,
   argsList: argsList
  });
  JSEvents.deferredCalls.sort((function(x, y) {
   return x.precedence < y.precedence;
  }));
 }),
 removeDeferredCalls: (function(targetFunction) {
  for (var i = 0; i < JSEvents.deferredCalls.length; ++i) {
   if (JSEvents.deferredCalls[i].targetFunction == targetFunction) {
    JSEvents.deferredCalls.splice(i, 1);
    --i;
   }
  }
 }),
 canPerformEventHandlerRequests: (function() {
  return JSEvents.inEventHandler && JSEvents.currentEventHandler.allowsDeferredCalls;
 }),
 runDeferredCalls: (function() {
  if (!JSEvents.canPerformEventHandlerRequests()) {
   return;
  }
  for (var i = 0; i < JSEvents.deferredCalls.length; ++i) {
   var call = JSEvents.deferredCalls[i];
   JSEvents.deferredCalls.splice(i, 1);
   --i;
   call.targetFunction.apply(this, call.argsList);
  }
 }),
 inEventHandler: 0,
 currentEventHandler: null,
 eventHandlers: [],
 isInternetExplorer: (function() {
  return navigator.userAgent.indexOf("MSIE") !== -1 || navigator.appVersion.indexOf("Trident/") > 0;
 }),
 removeAllHandlersOnTarget: (function(target, eventTypeString) {
  for (var i = 0; i < JSEvents.eventHandlers.length; ++i) {
   if (JSEvents.eventHandlers[i].target == target && (!eventTypeString || eventTypeString == JSEvents.eventHandlers[i].eventTypeString)) {
    JSEvents._removeHandler(i--);
   }
  }
 }),
 _removeHandler: (function(i) {
  var h = JSEvents.eventHandlers[i];
  h.target.removeEventListener(h.eventTypeString, h.eventListenerFunc, h.useCapture);
  JSEvents.eventHandlers.splice(i, 1);
 }),
 registerOrRemoveHandler: (function(eventHandler) {
  var jsEventHandler = function jsEventHandler(event) {
   ++JSEvents.inEventHandler;
   JSEvents.currentEventHandler = eventHandler;
   JSEvents.runDeferredCalls();
   eventHandler.handlerFunc(event);
   JSEvents.runDeferredCalls();
   --JSEvents.inEventHandler;
  };
  if (eventHandler.callbackfunc) {
   eventHandler.eventListenerFunc = jsEventHandler;
   eventHandler.target.addEventListener(eventHandler.eventTypeString, jsEventHandler, eventHandler.useCapture);
   JSEvents.eventHandlers.push(eventHandler);
   JSEvents.registerRemoveEventListeners();
  } else {
   for (var i = 0; i < JSEvents.eventHandlers.length; ++i) {
    if (JSEvents.eventHandlers[i].target == eventHandler.target && JSEvents.eventHandlers[i].eventTypeString == eventHandler.eventTypeString) {
     JSEvents._removeHandler(i--);
    }
   }
  }
 }),
 registerKeyEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.keyEvent) {
   JSEvents.keyEvent = _malloc(164);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   stringToUTF8(e.key ? e.key : "", JSEvents.keyEvent + 0, 32);
   stringToUTF8(e.code ? e.code : "", JSEvents.keyEvent + 32, 32);
   HEAP32[JSEvents.keyEvent + 64 >> 2] = e.location;
   HEAP32[JSEvents.keyEvent + 68 >> 2] = e.ctrlKey;
   HEAP32[JSEvents.keyEvent + 72 >> 2] = e.shiftKey;
   HEAP32[JSEvents.keyEvent + 76 >> 2] = e.altKey;
   HEAP32[JSEvents.keyEvent + 80 >> 2] = e.metaKey;
   HEAP32[JSEvents.keyEvent + 84 >> 2] = e.repeat;
   stringToUTF8(e.locale ? e.locale : "", JSEvents.keyEvent + 88, 32);
   stringToUTF8(e.char ? e.char : "", JSEvents.keyEvent + 120, 32);
   HEAP32[JSEvents.keyEvent + 152 >> 2] = e.charCode;
   HEAP32[JSEvents.keyEvent + 156 >> 2] = e.keyCode;
   HEAP32[JSEvents.keyEvent + 160 >> 2] = e.which;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.keyEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: JSEvents.isInternetExplorer() ? false : true,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 getBoundingClientRectOrZeros: (function(target) {
  return target.getBoundingClientRect ? target.getBoundingClientRect() : {
   left: 0,
   top: 0
  };
 }),
 fillMouseEventData: (function(eventStruct, e, target) {
  HEAPF64[eventStruct >> 3] = JSEvents.tick();
  HEAP32[eventStruct + 8 >> 2] = e.screenX;
  HEAP32[eventStruct + 12 >> 2] = e.screenY;
  HEAP32[eventStruct + 16 >> 2] = e.clientX;
  HEAP32[eventStruct + 20 >> 2] = e.clientY;
  HEAP32[eventStruct + 24 >> 2] = e.ctrlKey;
  HEAP32[eventStruct + 28 >> 2] = e.shiftKey;
  HEAP32[eventStruct + 32 >> 2] = e.altKey;
  HEAP32[eventStruct + 36 >> 2] = e.metaKey;
  HEAP16[eventStruct + 40 >> 1] = e.button;
  HEAP16[eventStruct + 42 >> 1] = e.buttons;
  HEAP32[eventStruct + 44 >> 2] = e["movementX"] || e["mozMovementX"] || e["webkitMovementX"] || e.screenX - JSEvents.previousScreenX;
  HEAP32[eventStruct + 48 >> 2] = e["movementY"] || e["mozMovementY"] || e["webkitMovementY"] || e.screenY - JSEvents.previousScreenY;
  if (Module["canvas"]) {
   var rect = Module["canvas"].getBoundingClientRect();
   HEAP32[eventStruct + 60 >> 2] = e.clientX - rect.left;
   HEAP32[eventStruct + 64 >> 2] = e.clientY - rect.top;
  } else {
   HEAP32[eventStruct + 60 >> 2] = 0;
   HEAP32[eventStruct + 64 >> 2] = 0;
  }
  if (target) {
   var rect = JSEvents.getBoundingClientRectOrZeros(target);
   HEAP32[eventStruct + 52 >> 2] = e.clientX - rect.left;
   HEAP32[eventStruct + 56 >> 2] = e.clientY - rect.top;
  } else {
   HEAP32[eventStruct + 52 >> 2] = 0;
   HEAP32[eventStruct + 56 >> 2] = 0;
  }
  JSEvents.previousScreenX = e.screenX;
  JSEvents.previousScreenY = e.screenY;
 }),
 registerMouseEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.mouseEvent) {
   JSEvents.mouseEvent = _malloc(72);
  }
  target = JSEvents.findEventTarget(target);
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillMouseEventData(JSEvents.mouseEvent, e, target);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.mouseEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: eventTypeString != "mousemove" && eventTypeString != "mouseenter" && eventTypeString != "mouseleave",
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  if (JSEvents.isInternetExplorer() && eventTypeString == "mousedown") eventHandler.allowsDeferredCalls = false;
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerWheelEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.wheelEvent) {
   JSEvents.wheelEvent = _malloc(104);
  }
  target = JSEvents.findEventTarget(target);
  var wheelHandlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillMouseEventData(JSEvents.wheelEvent, e, target);
   HEAPF64[JSEvents.wheelEvent + 72 >> 3] = e["deltaX"];
   HEAPF64[JSEvents.wheelEvent + 80 >> 3] = e["deltaY"];
   HEAPF64[JSEvents.wheelEvent + 88 >> 3] = e["deltaZ"];
   HEAP32[JSEvents.wheelEvent + 96 >> 2] = e["deltaMode"];
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.wheelEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var mouseWheelHandlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillMouseEventData(JSEvents.wheelEvent, e, target);
   HEAPF64[JSEvents.wheelEvent + 72 >> 3] = e["wheelDeltaX"] || 0;
   HEAPF64[JSEvents.wheelEvent + 80 >> 3] = -(e["wheelDeltaY"] ? e["wheelDeltaY"] : e["wheelDelta"]);
   HEAPF64[JSEvents.wheelEvent + 88 >> 3] = 0;
   HEAP32[JSEvents.wheelEvent + 96 >> 2] = 0;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.wheelEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: true,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: eventTypeString == "wheel" ? wheelHandlerFunc : mouseWheelHandlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 pageScrollPos: (function() {
  if (window.pageXOffset > 0 || window.pageYOffset > 0) {
   return [ window.pageXOffset, window.pageYOffset ];
  }
  if (typeof document.documentElement.scrollLeft !== "undefined" || typeof document.documentElement.scrollTop !== "undefined") {
   return [ document.documentElement.scrollLeft, document.documentElement.scrollTop ];
  }
  return [ document.body.scrollLeft | 0, document.body.scrollTop | 0 ];
 }),
 registerUiEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.uiEvent) {
   JSEvents.uiEvent = _malloc(36);
  }
  if (eventTypeString == "scroll" && !target) {
   target = document;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   if (e.target != target) {
    return;
   }
   var scrollPos = JSEvents.pageScrollPos();
   HEAP32[JSEvents.uiEvent >> 2] = e.detail;
   HEAP32[JSEvents.uiEvent + 4 >> 2] = document.body.clientWidth;
   HEAP32[JSEvents.uiEvent + 8 >> 2] = document.body.clientHeight;
   HEAP32[JSEvents.uiEvent + 12 >> 2] = window.innerWidth;
   HEAP32[JSEvents.uiEvent + 16 >> 2] = window.innerHeight;
   HEAP32[JSEvents.uiEvent + 20 >> 2] = window.outerWidth;
   HEAP32[JSEvents.uiEvent + 24 >> 2] = window.outerHeight;
   HEAP32[JSEvents.uiEvent + 28 >> 2] = scrollPos[0];
   HEAP32[JSEvents.uiEvent + 32 >> 2] = scrollPos[1];
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.uiEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 getNodeNameForTarget: (function(target) {
  if (!target) return "";
  if (target == window) return "#window";
  if (target == window.screen) return "#screen";
  return target && target.nodeName ? target.nodeName : "";
 }),
 registerFocusEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.focusEvent) {
   JSEvents.focusEvent = _malloc(256);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   var nodeName = JSEvents.getNodeNameForTarget(e.target);
   var id = e.target.id ? e.target.id : "";
   stringToUTF8(nodeName, JSEvents.focusEvent + 0, 128);
   stringToUTF8(id, JSEvents.focusEvent + 128, 128);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.focusEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 tick: (function() {
  if (window["performance"] && window["performance"]["now"]) return window["performance"]["now"](); else return Date.now();
 }),
 registerDeviceOrientationEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.deviceOrientationEvent) {
   JSEvents.deviceOrientationEvent = _malloc(40);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   HEAPF64[JSEvents.deviceOrientationEvent >> 3] = JSEvents.tick();
   HEAPF64[JSEvents.deviceOrientationEvent + 8 >> 3] = e.alpha;
   HEAPF64[JSEvents.deviceOrientationEvent + 16 >> 3] = e.beta;
   HEAPF64[JSEvents.deviceOrientationEvent + 24 >> 3] = e.gamma;
   HEAP32[JSEvents.deviceOrientationEvent + 32 >> 2] = e.absolute;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.deviceOrientationEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerDeviceMotionEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.deviceMotionEvent) {
   JSEvents.deviceMotionEvent = _malloc(80);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   HEAPF64[JSEvents.deviceOrientationEvent >> 3] = JSEvents.tick();
   HEAPF64[JSEvents.deviceMotionEvent + 8 >> 3] = e.acceleration.x;
   HEAPF64[JSEvents.deviceMotionEvent + 16 >> 3] = e.acceleration.y;
   HEAPF64[JSEvents.deviceMotionEvent + 24 >> 3] = e.acceleration.z;
   HEAPF64[JSEvents.deviceMotionEvent + 32 >> 3] = e.accelerationIncludingGravity.x;
   HEAPF64[JSEvents.deviceMotionEvent + 40 >> 3] = e.accelerationIncludingGravity.y;
   HEAPF64[JSEvents.deviceMotionEvent + 48 >> 3] = e.accelerationIncludingGravity.z;
   HEAPF64[JSEvents.deviceMotionEvent + 56 >> 3] = e.rotationRate.alpha;
   HEAPF64[JSEvents.deviceMotionEvent + 64 >> 3] = e.rotationRate.beta;
   HEAPF64[JSEvents.deviceMotionEvent + 72 >> 3] = e.rotationRate.gamma;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.deviceMotionEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 screenOrientation: (function() {
  if (!window.screen) return undefined;
  return window.screen.orientation || window.screen.mozOrientation || window.screen.webkitOrientation || window.screen.msOrientation;
 }),
 fillOrientationChangeEventData: (function(eventStruct, e) {
  var orientations = [ "portrait-primary", "portrait-secondary", "landscape-primary", "landscape-secondary" ];
  var orientations2 = [ "portrait", "portrait", "landscape", "landscape" ];
  var orientationString = JSEvents.screenOrientation();
  var orientation = orientations.indexOf(orientationString);
  if (orientation == -1) {
   orientation = orientations2.indexOf(orientationString);
  }
  HEAP32[eventStruct >> 2] = 1 << orientation;
  HEAP32[eventStruct + 4 >> 2] = window.orientation;
 }),
 registerOrientationChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.orientationChangeEvent) {
   JSEvents.orientationChangeEvent = _malloc(8);
  }
  if (!target) {
   target = window.screen;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillOrientationChangeEventData(JSEvents.orientationChangeEvent, e);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.orientationChangeEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  if (eventTypeString == "orientationchange" && window.screen.mozOrientation !== undefined) {
   eventTypeString = "mozorientationchange";
  }
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 fullscreenEnabled: (function() {
  return document.fullscreenEnabled || document.mozFullScreenEnabled || document.webkitFullscreenEnabled || document.msFullscreenEnabled;
 }),
 fillFullscreenChangeEventData: (function(eventStruct, e) {
  var fullscreenElement = document.fullscreenElement || document.mozFullScreenElement || document.webkitFullscreenElement || document.msFullscreenElement;
  var isFullscreen = !!fullscreenElement;
  HEAP32[eventStruct >> 2] = isFullscreen;
  HEAP32[eventStruct + 4 >> 2] = JSEvents.fullscreenEnabled();
  var reportedElement = isFullscreen ? fullscreenElement : JSEvents.previousFullscreenElement;
  var nodeName = JSEvents.getNodeNameForTarget(reportedElement);
  var id = reportedElement && reportedElement.id ? reportedElement.id : "";
  stringToUTF8(nodeName, eventStruct + 8, 128);
  stringToUTF8(id, eventStruct + 136, 128);
  HEAP32[eventStruct + 264 >> 2] = reportedElement ? reportedElement.clientWidth : 0;
  HEAP32[eventStruct + 268 >> 2] = reportedElement ? reportedElement.clientHeight : 0;
  HEAP32[eventStruct + 272 >> 2] = screen.width;
  HEAP32[eventStruct + 276 >> 2] = screen.height;
  if (isFullscreen) {
   JSEvents.previousFullscreenElement = fullscreenElement;
  }
 }),
 registerFullscreenChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.fullscreenChangeEvent) {
   JSEvents.fullscreenChangeEvent = _malloc(280);
  }
  if (!target) {
   target = document;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillFullscreenChangeEventData(JSEvents.fullscreenChangeEvent, e);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.fullscreenChangeEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 resizeCanvasForFullscreen: (function(target, strategy) {
  var restoreOldStyle = __registerRestoreOldStyle(target);
  var cssWidth = strategy.softFullscreen ? window.innerWidth : screen.width;
  var cssHeight = strategy.softFullscreen ? window.innerHeight : screen.height;
  var rect = target.getBoundingClientRect();
  var windowedCssWidth = rect.right - rect.left;
  var windowedCssHeight = rect.bottom - rect.top;
  var windowedRttWidth = target.width;
  var windowedRttHeight = target.height;
  if (strategy.scaleMode == 3) {
   __setLetterbox(target, (cssHeight - windowedCssHeight) / 2, (cssWidth - windowedCssWidth) / 2);
   cssWidth = windowedCssWidth;
   cssHeight = windowedCssHeight;
  } else if (strategy.scaleMode == 2) {
   if (cssWidth * windowedRttHeight < windowedRttWidth * cssHeight) {
    var desiredCssHeight = windowedRttHeight * cssWidth / windowedRttWidth;
    __setLetterbox(target, (cssHeight - desiredCssHeight) / 2, 0);
    cssHeight = desiredCssHeight;
   } else {
    var desiredCssWidth = windowedRttWidth * cssHeight / windowedRttHeight;
    __setLetterbox(target, 0, (cssWidth - desiredCssWidth) / 2);
    cssWidth = desiredCssWidth;
   }
  }
  if (!target.style.backgroundColor) target.style.backgroundColor = "black";
  if (!document.body.style.backgroundColor) document.body.style.backgroundColor = "black";
  target.style.width = cssWidth + "px";
  target.style.height = cssHeight + "px";
  if (strategy.filteringMode == 1) {
   target.style.imageRendering = "optimizeSpeed";
   target.style.imageRendering = "-moz-crisp-edges";
   target.style.imageRendering = "-o-crisp-edges";
   target.style.imageRendering = "-webkit-optimize-contrast";
   target.style.imageRendering = "optimize-contrast";
   target.style.imageRendering = "crisp-edges";
   target.style.imageRendering = "pixelated";
  }
  var dpiScale = strategy.canvasResolutionScaleMode == 2 ? window.devicePixelRatio : 1;
  if (strategy.canvasResolutionScaleMode != 0) {
   target.width = cssWidth * dpiScale;
   target.height = cssHeight * dpiScale;
   if (target.GLctxObject) target.GLctxObject.GLctx.viewport(0, 0, target.width, target.height);
  }
  return restoreOldStyle;
 }),
 requestFullscreen: (function(target, strategy) {
  if (strategy.scaleMode != 0 || strategy.canvasResolutionScaleMode != 0) {
   JSEvents.resizeCanvasForFullscreen(target, strategy);
  }
  if (target.requestFullscreen) {
   target.requestFullscreen();
  } else if (target.msRequestFullscreen) {
   target.msRequestFullscreen();
  } else if (target.mozRequestFullScreen) {
   target.mozRequestFullScreen();
  } else if (target.mozRequestFullscreen) {
   target.mozRequestFullscreen();
  } else if (target.webkitRequestFullscreen) {
   target.webkitRequestFullscreen(Element.ALLOW_KEYBOARD_INPUT);
  } else {
   if (typeof JSEvents.fullscreenEnabled() === "undefined") {
    return -1;
   } else {
    return -3;
   }
  }
  if (strategy.canvasResizedCallback) {
   Module["dynCall_iiii"](strategy.canvasResizedCallback, 37, 0, strategy.canvasResizedCallbackUserData);
  }
  return 0;
 }),
 fillPointerlockChangeEventData: (function(eventStruct, e) {
  var pointerLockElement = document.pointerLockElement || document.mozPointerLockElement || document.webkitPointerLockElement || document.msPointerLockElement;
  var isPointerlocked = !!pointerLockElement;
  HEAP32[eventStruct >> 2] = isPointerlocked;
  var nodeName = JSEvents.getNodeNameForTarget(pointerLockElement);
  var id = pointerLockElement && pointerLockElement.id ? pointerLockElement.id : "";
  stringToUTF8(nodeName, eventStruct + 4, 128);
  stringToUTF8(id, eventStruct + 132, 128);
 }),
 registerPointerlockChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.pointerlockChangeEvent) {
   JSEvents.pointerlockChangeEvent = _malloc(260);
  }
  if (!target) {
   target = document;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillPointerlockChangeEventData(JSEvents.pointerlockChangeEvent, e);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.pointerlockChangeEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerPointerlockErrorEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!target) {
   target = document;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, 0, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 requestPointerLock: (function(target) {
  if (target.requestPointerLock) {
   target.requestPointerLock();
  } else if (target.mozRequestPointerLock) {
   target.mozRequestPointerLock();
  } else if (target.webkitRequestPointerLock) {
   target.webkitRequestPointerLock();
  } else if (target.msRequestPointerLock) {
   target.msRequestPointerLock();
  } else {
   if (document.body.requestPointerLock || document.body.mozRequestPointerLock || document.body.webkitRequestPointerLock || document.body.msRequestPointerLock) {
    return -3;
   } else {
    return -1;
   }
  }
  return 0;
 }),
 fillVisibilityChangeEventData: (function(eventStruct, e) {
  var visibilityStates = [ "hidden", "visible", "prerender", "unloaded" ];
  var visibilityState = visibilityStates.indexOf(document.visibilityState);
  HEAP32[eventStruct >> 2] = document.hidden;
  HEAP32[eventStruct + 4 >> 2] = visibilityState;
 }),
 registerVisibilityChangeEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.visibilityChangeEvent) {
   JSEvents.visibilityChangeEvent = _malloc(8);
  }
  if (!target) {
   target = document;
  } else {
   target = JSEvents.findEventTarget(target);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillVisibilityChangeEventData(JSEvents.visibilityChangeEvent, e);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.visibilityChangeEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerTouchEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.touchEvent) {
   JSEvents.touchEvent = _malloc(1684);
  }
  target = JSEvents.findEventTarget(target);
  var handlerFunc = (function(event) {
   var e = event || window.event;
   var touches = {};
   for (var i = 0; i < e.touches.length; ++i) {
    var touch = e.touches[i];
    touches[touch.identifier] = touch;
   }
   for (var i = 0; i < e.changedTouches.length; ++i) {
    var touch = e.changedTouches[i];
    touches[touch.identifier] = touch;
    touch.changed = true;
   }
   for (var i = 0; i < e.targetTouches.length; ++i) {
    var touch = e.targetTouches[i];
    touches[touch.identifier].onTarget = true;
   }
   var ptr = JSEvents.touchEvent;
   HEAP32[ptr + 4 >> 2] = e.ctrlKey;
   HEAP32[ptr + 8 >> 2] = e.shiftKey;
   HEAP32[ptr + 12 >> 2] = e.altKey;
   HEAP32[ptr + 16 >> 2] = e.metaKey;
   ptr += 20;
   var canvasRect = Module["canvas"] ? Module["canvas"].getBoundingClientRect() : undefined;
   var targetRect = JSEvents.getBoundingClientRectOrZeros(target);
   var numTouches = 0;
   for (var i in touches) {
    var t = touches[i];
    HEAP32[ptr >> 2] = t.identifier;
    HEAP32[ptr + 4 >> 2] = t.screenX;
    HEAP32[ptr + 8 >> 2] = t.screenY;
    HEAP32[ptr + 12 >> 2] = t.clientX;
    HEAP32[ptr + 16 >> 2] = t.clientY;
    HEAP32[ptr + 20 >> 2] = t.pageX;
    HEAP32[ptr + 24 >> 2] = t.pageY;
    HEAP32[ptr + 28 >> 2] = t.changed;
    HEAP32[ptr + 32 >> 2] = t.onTarget;
    if (canvasRect) {
     HEAP32[ptr + 44 >> 2] = t.clientX - canvasRect.left;
     HEAP32[ptr + 48 >> 2] = t.clientY - canvasRect.top;
    } else {
     HEAP32[ptr + 44 >> 2] = 0;
     HEAP32[ptr + 48 >> 2] = 0;
    }
    HEAP32[ptr + 36 >> 2] = t.clientX - targetRect.left;
    HEAP32[ptr + 40 >> 2] = t.clientY - targetRect.top;
    ptr += 52;
    if (++numTouches >= 32) {
     break;
    }
   }
   HEAP32[JSEvents.touchEvent >> 2] = numTouches;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.touchEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: target,
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 fillGamepadEventData: (function(eventStruct, e) {
  HEAPF64[eventStruct >> 3] = e.timestamp;
  for (var i = 0; i < e.axes.length; ++i) {
   HEAPF64[eventStruct + i * 8 + 16 >> 3] = e.axes[i];
  }
  for (var i = 0; i < e.buttons.length; ++i) {
   if (typeof e.buttons[i] === "object") {
    HEAPF64[eventStruct + i * 8 + 528 >> 3] = e.buttons[i].value;
   } else {
    HEAPF64[eventStruct + i * 8 + 528 >> 3] = e.buttons[i];
   }
  }
  for (var i = 0; i < e.buttons.length; ++i) {
   if (typeof e.buttons[i] === "object") {
    HEAP32[eventStruct + i * 4 + 1040 >> 2] = e.buttons[i].pressed;
   } else {
    HEAP32[eventStruct + i * 4 + 1040 >> 2] = e.buttons[i] == 1;
   }
  }
  HEAP32[eventStruct + 1296 >> 2] = e.connected;
  HEAP32[eventStruct + 1300 >> 2] = e.index;
  HEAP32[eventStruct + 8 >> 2] = e.axes.length;
  HEAP32[eventStruct + 12 >> 2] = e.buttons.length;
  stringToUTF8(e.id, eventStruct + 1304, 64);
  stringToUTF8(e.mapping, eventStruct + 1368, 64);
 }),
 registerGamepadEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.gamepadEvent) {
   JSEvents.gamepadEvent = _malloc(1432);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillGamepadEventData(JSEvents.gamepadEvent, e.gamepad);
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.gamepadEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: true,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerBeforeUnloadEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  var handlerFunc = (function(event) {
   var e = event || window.event;
   var confirmationMessage = Module["dynCall_iiii"](callbackfunc, eventTypeId, 0, userData);
   if (confirmationMessage) {
    confirmationMessage = Pointer_stringify(confirmationMessage);
   }
   if (confirmationMessage) {
    e.preventDefault();
    e.returnValue = confirmationMessage;
    return confirmationMessage;
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 battery: (function() {
  return navigator.battery || navigator.mozBattery || navigator.webkitBattery;
 }),
 fillBatteryEventData: (function(eventStruct, e) {
  HEAPF64[eventStruct >> 3] = e.chargingTime;
  HEAPF64[eventStruct + 8 >> 3] = e.dischargingTime;
  HEAPF64[eventStruct + 16 >> 3] = e.level;
  HEAP32[eventStruct + 24 >> 2] = e.charging;
 }),
 registerBatteryEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!JSEvents.batteryEvent) {
   JSEvents.batteryEvent = _malloc(32);
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   JSEvents.fillBatteryEventData(JSEvents.batteryEvent, JSEvents.battery());
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, JSEvents.batteryEvent, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 }),
 registerWebGlEventCallback: (function(target, userData, useCapture, callbackfunc, eventTypeId, eventTypeString) {
  if (!target) {
   target = Module["canvas"];
  }
  var handlerFunc = (function(event) {
   var e = event || window.event;
   var shouldCancel = Module["dynCall_iiii"](callbackfunc, eventTypeId, 0, userData);
   if (shouldCancel) {
    e.preventDefault();
   }
  });
  var eventHandler = {
   target: JSEvents.findEventTarget(target),
   allowsDeferredCalls: false,
   eventTypeString: eventTypeString,
   callbackfunc: callbackfunc,
   handlerFunc: handlerFunc,
   useCapture: useCapture
  };
  JSEvents.registerOrRemoveHandler(eventHandler);
 })
};
var __currentFullscreenStrategy = {};
function _emscripten_exit_fullscreen() {
 if (typeof JSEvents.fullscreenEnabled() === "undefined") return -1;
 JSEvents.removeDeferredCalls(JSEvents.requestFullscreen);
 if (document.exitFullscreen) {
  document.exitFullscreen();
 } else if (document.msExitFullscreen) {
  document.msExitFullscreen();
 } else if (document.mozCancelFullScreen) {
  document.mozCancelFullScreen();
 } else if (document.webkitExitFullscreen) {
  document.webkitExitFullscreen();
 } else {
  return -1;
 }
 if (__currentFullscreenStrategy.canvasResizedCallback) {
  Module["dynCall_iiii"](__currentFullscreenStrategy.canvasResizedCallback, 37, 0, __currentFullscreenStrategy.canvasResizedCallbackUserData);
 }
 return 0;
}
function _glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
 GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget, GL.renderbuffers[renderbuffer]);
}
function _emscripten_glVertexPointer() {
 throw "Legacy GL function (glVertexPointer) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.";
}
function _emscripten_glUniform3iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 3;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform3iv(location, value);
}
function _glCompressedTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, imageSize, data) {
 var heapView;
 if (data) {
  heapView = HEAPU8.subarray(data, data + imageSize);
 } else {
  heapView = null;
 }
 GLctx["compressedTexSubImage2D"](target, level, xoffset, yoffset, zoffset, width, height, depth, format, heapView);
}
var _llvm_pow_f32 = Math_pow;
function _glBindSampler(unit, sampler) {
 GLctx["bindSampler"](unit, sampler ? GL.samplers[sampler] : null);
}
function _glProgramParameteri(program, pname, value) {
 GL.recordError(1280);
}
function _emscripten_glTexParameterf(x0, x1, x2) {
 GLctx["texParameterf"](x0, x1, x2);
}
function _emscripten_webgl_destroy_context(contextHandle) {
 GL.deleteContext(contextHandle);
}
function emscriptenWebGLGetIndexed(target, index, data, type) {
 if (!data) {
  GL.recordError(1281);
  return;
 }
 var result = GLctx["getIndexedParameter"](target, index);
 var ret;
 switch (typeof result) {
 case "boolean":
  ret = result ? 1 : 0;
  break;
 case "number":
  ret = result;
  break;
 case "object":
  if (result === null) {
   switch (target) {
   case 35983:
   case 35368:
    ret = 0;
    break;
   default:
    {
     GL.recordError(1280);
     return;
    }
   }
  } else if (result instanceof WebGLBuffer) {
   ret = result.name | 0;
  } else {
   GL.recordError(1280);
   return;
  }
  break;
 default:
  GL.recordError(1280);
  return;
 }
 switch (type) {
 case "Integer64":
  tempI64 = [ ret >>> 0, (tempDouble = ret, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0) ], HEAP32[data >> 2] = tempI64[0], HEAP32[data + 4 >> 2] = tempI64[1];
  break;
 case "Integer":
  HEAP32[data >> 2] = ret;
  break;
 case "Float":
  HEAPF32[data >> 2] = ret;
  break;
 case "Boolean":
  HEAP8[data >> 0] = ret ? 1 : 0;
  break;
 default:
  throw "internal emscriptenWebGLGetIndexed() error, bad type: " + type;
 }
}
function _glGetIntegeri_v(target, index, data) {
 emscriptenWebGLGetIndexed(target, index, data, "Integer");
}
function _emscripten_glTexParameteri(x0, x1, x2) {
 GLctx["texParameteri"](x0, x1, x2);
}
function _glCompileShader(shader) {
 GLctx.compileShader(GL.shaders[shader]);
}
var ___tm_current = STATICTOP;
STATICTOP += 48;
var ___tm_timezone = allocate(intArrayFromString("GMT"), "i8", ALLOC_STATIC);
var _tzname = STATICTOP;
STATICTOP += 16;
var _daylight = STATICTOP;
STATICTOP += 16;
var _timezone = STATICTOP;
STATICTOP += 16;
function _tzset() {
 if (_tzset.called) return;
 _tzset.called = true;
 HEAP32[_timezone >> 2] = -(new Date).getTimezoneOffset() * 60;
 var winter = new Date(2e3, 0, 1);
 var summer = new Date(2e3, 6, 1);
 HEAP32[_daylight >> 2] = Number(winter.getTimezoneOffset() != summer.getTimezoneOffset());
 function extractZone(date) {
  var match = date.toTimeString().match(/\(([A-Za-z ]+)\)$/);
  return match ? match[1] : "GMT";
 }
 var winterName = extractZone(winter);
 var summerName = extractZone(summer);
 var winterNamePtr = allocate(intArrayFromString(winterName), "i8", ALLOC_NORMAL);
 var summerNamePtr = allocate(intArrayFromString(summerName), "i8", ALLOC_NORMAL);
 if (summer.getTimezoneOffset() < winter.getTimezoneOffset()) {
  HEAP32[_tzname >> 2] = winterNamePtr;
  HEAP32[_tzname + 4 >> 2] = summerNamePtr;
 } else {
  HEAP32[_tzname >> 2] = summerNamePtr;
  HEAP32[_tzname + 4 >> 2] = winterNamePtr;
 }
}
function _localtime_r(time, tmPtr) {
 _tzset();
 var date = new Date(HEAP32[time >> 2] * 1e3);
 HEAP32[tmPtr >> 2] = date.getSeconds();
 HEAP32[tmPtr + 4 >> 2] = date.getMinutes();
 HEAP32[tmPtr + 8 >> 2] = date.getHours();
 HEAP32[tmPtr + 12 >> 2] = date.getDate();
 HEAP32[tmPtr + 16 >> 2] = date.getMonth();
 HEAP32[tmPtr + 20 >> 2] = date.getFullYear() - 1900;
 HEAP32[tmPtr + 24 >> 2] = date.getDay();
 var start = new Date(date.getFullYear(), 0, 1);
 var yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
 HEAP32[tmPtr + 28 >> 2] = yday;
 HEAP32[tmPtr + 36 >> 2] = -(date.getTimezoneOffset() * 60);
 var summerOffset = (new Date(2e3, 6, 1)).getTimezoneOffset();
 var winterOffset = start.getTimezoneOffset();
 var dst = date.getTimezoneOffset() == Math.min(winterOffset, summerOffset) | 0;
 HEAP32[tmPtr + 32 >> 2] = dst;
 var zonePtr = HEAP32[_tzname + (dst ? Runtime.QUANTUM_SIZE : 0) >> 2];
 HEAP32[tmPtr + 40 >> 2] = zonePtr;
 return tmPtr;
}
function _localtime(time) {
 return _localtime_r(time, ___tm_current);
}
function _emscripten_glFrustum() {
 Module["printErr"]("missing function: emscripten_glFrustum");
 abort(-1);
}
function _emscripten_glGetTexParameterfv(target, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 HEAPF32[params >> 2] = GLctx.getTexParameter(target, pname);
}
function _emscripten_glBindRenderbuffer(target, renderbuffer) {
 GLctx.bindRenderbuffer(target, renderbuffer ? GL.renderbuffers[renderbuffer] : null);
}
function _glVertexAttribIPointer(index, size, type, stride, ptr) {
 GLctx.vertexAttribIPointer(index, size, type, stride, ptr);
}
function __emscripten_sample_gamepad_data() {
 if (Browser.mainLoop.currentFrameNumber !== JSEvents.lastGamepadStateFrame || !Browser.mainLoop.currentFrameNumber) {
  JSEvents.lastGamepadState = navigator.getGamepads ? navigator.getGamepads() : navigator.webkitGetGamepads ? navigator.webkitGetGamepads : null;
  JSEvents.lastGamepadStateFrame = Browser.mainLoop.currentFrameNumber;
 }
}
function _emscripten_get_gamepad_status(index, gamepadState) {
 __emscripten_sample_gamepad_data();
 if (!JSEvents.lastGamepadState) return -1;
 if (index < 0 || index >= JSEvents.lastGamepadState.length) return -5;
 if (!JSEvents.lastGamepadState[index]) return -7;
 JSEvents.fillGamepadEventData(gamepadState, JSEvents.lastGamepadState[index]);
 return 0;
}
var ERRNO_CODES = {
 EPERM: 1,
 ENOENT: 2,
 ESRCH: 3,
 EINTR: 4,
 EIO: 5,
 ENXIO: 6,
 E2BIG: 7,
 ENOEXEC: 8,
 EBADF: 9,
 ECHILD: 10,
 EAGAIN: 11,
 EWOULDBLOCK: 11,
 ENOMEM: 12,
 EACCES: 13,
 EFAULT: 14,
 ENOTBLK: 15,
 EBUSY: 16,
 EEXIST: 17,
 EXDEV: 18,
 ENODEV: 19,
 ENOTDIR: 20,
 EISDIR: 21,
 EINVAL: 22,
 ENFILE: 23,
 EMFILE: 24,
 ENOTTY: 25,
 ETXTBSY: 26,
 EFBIG: 27,
 ENOSPC: 28,
 ESPIPE: 29,
 EROFS: 30,
 EMLINK: 31,
 EPIPE: 32,
 EDOM: 33,
 ERANGE: 34,
 ENOMSG: 42,
 EIDRM: 43,
 ECHRNG: 44,
 EL2NSYNC: 45,
 EL3HLT: 46,
 EL3RST: 47,
 ELNRNG: 48,
 EUNATCH: 49,
 ENOCSI: 50,
 EL2HLT: 51,
 EDEADLK: 35,
 ENOLCK: 37,
 EBADE: 52,
 EBADR: 53,
 EXFULL: 54,
 ENOANO: 55,
 EBADRQC: 56,
 EBADSLT: 57,
 EDEADLOCK: 35,
 EBFONT: 59,
 ENOSTR: 60,
 ENODATA: 61,
 ETIME: 62,
 ENOSR: 63,
 ENONET: 64,
 ENOPKG: 65,
 EREMOTE: 66,
 ENOLINK: 67,
 EADV: 68,
 ESRMNT: 69,
 ECOMM: 70,
 EPROTO: 71,
 EMULTIHOP: 72,
 EDOTDOT: 73,
 EBADMSG: 74,
 ENOTUNIQ: 76,
 EBADFD: 77,
 EREMCHG: 78,
 ELIBACC: 79,
 ELIBBAD: 80,
 ELIBSCN: 81,
 ELIBMAX: 82,
 ELIBEXEC: 83,
 ENOSYS: 38,
 ENOTEMPTY: 39,
 ENAMETOOLONG: 36,
 ELOOP: 40,
 EOPNOTSUPP: 95,
 EPFNOSUPPORT: 96,
 ECONNRESET: 104,
 ENOBUFS: 105,
 EAFNOSUPPORT: 97,
 EPROTOTYPE: 91,
 ENOTSOCK: 88,
 ENOPROTOOPT: 92,
 ESHUTDOWN: 108,
 ECONNREFUSED: 111,
 EADDRINUSE: 98,
 ECONNABORTED: 103,
 ENETUNREACH: 101,
 ENETDOWN: 100,
 ETIMEDOUT: 110,
 EHOSTDOWN: 112,
 EHOSTUNREACH: 113,
 EINPROGRESS: 115,
 EALREADY: 114,
 EDESTADDRREQ: 89,
 EMSGSIZE: 90,
 EPROTONOSUPPORT: 93,
 ESOCKTNOSUPPORT: 94,
 EADDRNOTAVAIL: 99,
 ENETRESET: 102,
 EISCONN: 106,
 ENOTCONN: 107,
 ETOOMANYREFS: 109,
 EUSERS: 87,
 EDQUOT: 122,
 ESTALE: 116,
 ENOTSUP: 95,
 ENOMEDIUM: 123,
 EILSEQ: 84,
 EOVERFLOW: 75,
 ECANCELED: 125,
 ENOTRECOVERABLE: 131,
 EOWNERDEAD: 130,
 ESTRPIPE: 86
};
var ERRNO_MESSAGES = {
 0: "Success",
 1: "Not super-user",
 2: "No such file or directory",
 3: "No such process",
 4: "Interrupted system call",
 5: "I/O error",
 6: "No such device or address",
 7: "Arg list too long",
 8: "Exec format error",
 9: "Bad file number",
 10: "No children",
 11: "No more processes",
 12: "Not enough core",
 13: "Permission denied",
 14: "Bad address",
 15: "Block device required",
 16: "Mount device busy",
 17: "File exists",
 18: "Cross-device link",
 19: "No such device",
 20: "Not a directory",
 21: "Is a directory",
 22: "Invalid argument",
 23: "Too many open files in system",
 24: "Too many open files",
 25: "Not a typewriter",
 26: "Text file busy",
 27: "File too large",
 28: "No space left on device",
 29: "Illegal seek",
 30: "Read only file system",
 31: "Too many links",
 32: "Broken pipe",
 33: "Math arg out of domain of func",
 34: "Math result not representable",
 35: "File locking deadlock error",
 36: "File or path name too long",
 37: "No record locks available",
 38: "Function not implemented",
 39: "Directory not empty",
 40: "Too many symbolic links",
 42: "No message of desired type",
 43: "Identifier removed",
 44: "Channel number out of range",
 45: "Level 2 not synchronized",
 46: "Level 3 halted",
 47: "Level 3 reset",
 48: "Link number out of range",
 49: "Protocol driver not attached",
 50: "No CSI structure available",
 51: "Level 2 halted",
 52: "Invalid exchange",
 53: "Invalid request descriptor",
 54: "Exchange full",
 55: "No anode",
 56: "Invalid request code",
 57: "Invalid slot",
 59: "Bad font file fmt",
 60: "Device not a stream",
 61: "No data (for no delay io)",
 62: "Timer expired",
 63: "Out of streams resources",
 64: "Machine is not on the network",
 65: "Package not installed",
 66: "The object is remote",
 67: "The link has been severed",
 68: "Advertise error",
 69: "Srmount error",
 70: "Communication error on send",
 71: "Protocol error",
 72: "Multihop attempted",
 73: "Cross mount point (not really error)",
 74: "Trying to read unreadable message",
 75: "Value too large for defined data type",
 76: "Given log. name not unique",
 77: "f.d. invalid for this operation",
 78: "Remote address changed",
 79: "Can   access a needed shared lib",
 80: "Accessing a corrupted shared lib",
 81: ".lib section in a.out corrupted",
 82: "Attempting to link in too many libs",
 83: "Attempting to exec a shared library",
 84: "Illegal byte sequence",
 86: "Streams pipe error",
 87: "Too many users",
 88: "Socket operation on non-socket",
 89: "Destination address required",
 90: "Message too long",
 91: "Protocol wrong type for socket",
 92: "Protocol not available",
 93: "Unknown protocol",
 94: "Socket type not supported",
 95: "Not supported",
 96: "Protocol family not supported",
 97: "Address family not supported by protocol family",
 98: "Address already in use",
 99: "Address not available",
 100: "Network interface is not configured",
 101: "Network is unreachable",
 102: "Connection reset by network",
 103: "Connection aborted",
 104: "Connection reset by peer",
 105: "No buffer space available",
 106: "Socket is already connected",
 107: "Socket is not connected",
 108: "Can't send after socket shutdown",
 109: "Too many references",
 110: "Connection timed out",
 111: "Connection refused",
 112: "Host is down",
 113: "Host is unreachable",
 114: "Socket already connected",
 115: "Connection already in progress",
 116: "Stale file handle",
 122: "Quota exceeded",
 123: "No medium (in tape drive)",
 125: "Operation canceled",
 130: "Previous owner died",
 131: "State not recoverable"
};
function ___setErrNo(value) {
 if (Module["___errno_location"]) HEAP32[Module["___errno_location"]() >> 2] = value; else Module.printErr("failed to set errno from JS");
 return value;
}
var PATH = {
 splitPath: (function(filename) {
  var splitPathRe = /^(\/?|)([\s\S]*?)((?:\.{1,2}|[^\/]+?|)(\.[^.\/]*|))(?:[\/]*)$/;
  return splitPathRe.exec(filename).slice(1);
 }),
 normalizeArray: (function(parts, allowAboveRoot) {
  var up = 0;
  for (var i = parts.length - 1; i >= 0; i--) {
   var last = parts[i];
   if (last === ".") {
    parts.splice(i, 1);
   } else if (last === "..") {
    parts.splice(i, 1);
    up++;
   } else if (up) {
    parts.splice(i, 1);
    up--;
   }
  }
  if (allowAboveRoot) {
   for (; up--; up) {
    parts.unshift("..");
   }
  }
  return parts;
 }),
 normalize: (function(path) {
  var isAbsolute = path.charAt(0) === "/", trailingSlash = path.substr(-1) === "/";
  path = PATH.normalizeArray(path.split("/").filter((function(p) {
   return !!p;
  })), !isAbsolute).join("/");
  if (!path && !isAbsolute) {
   path = ".";
  }
  if (path && trailingSlash) {
   path += "/";
  }
  return (isAbsolute ? "/" : "") + path;
 }),
 dirname: (function(path) {
  var result = PATH.splitPath(path), root = result[0], dir = result[1];
  if (!root && !dir) {
   return ".";
  }
  if (dir) {
   dir = dir.substr(0, dir.length - 1);
  }
  return root + dir;
 }),
 basename: (function(path) {
  if (path === "/") return "/";
  var lastSlash = path.lastIndexOf("/");
  if (lastSlash === -1) return path;
  return path.substr(lastSlash + 1);
 }),
 extname: (function(path) {
  return PATH.splitPath(path)[3];
 }),
 join: (function() {
  var paths = Array.prototype.slice.call(arguments, 0);
  return PATH.normalize(paths.join("/"));
 }),
 join2: (function(l, r) {
  return PATH.normalize(l + "/" + r);
 }),
 resolve: (function() {
  var resolvedPath = "", resolvedAbsolute = false;
  for (var i = arguments.length - 1; i >= -1 && !resolvedAbsolute; i--) {
   var path = i >= 0 ? arguments[i] : FS.cwd();
   if (typeof path !== "string") {
    throw new TypeError("Arguments to path.resolve must be strings");
   } else if (!path) {
    return "";
   }
   resolvedPath = path + "/" + resolvedPath;
   resolvedAbsolute = path.charAt(0) === "/";
  }
  resolvedPath = PATH.normalizeArray(resolvedPath.split("/").filter((function(p) {
   return !!p;
  })), !resolvedAbsolute).join("/");
  return (resolvedAbsolute ? "/" : "") + resolvedPath || ".";
 }),
 relative: (function(from, to) {
  from = PATH.resolve(from).substr(1);
  to = PATH.resolve(to).substr(1);
  function trim(arr) {
   var start = 0;
   for (; start < arr.length; start++) {
    if (arr[start] !== "") break;
   }
   var end = arr.length - 1;
   for (; end >= 0; end--) {
    if (arr[end] !== "") break;
   }
   if (start > end) return [];
   return arr.slice(start, end - start + 1);
  }
  var fromParts = trim(from.split("/"));
  var toParts = trim(to.split("/"));
  var length = Math.min(fromParts.length, toParts.length);
  var samePartsLength = length;
  for (var i = 0; i < length; i++) {
   if (fromParts[i] !== toParts[i]) {
    samePartsLength = i;
    break;
   }
  }
  var outputParts = [];
  for (var i = samePartsLength; i < fromParts.length; i++) {
   outputParts.push("..");
  }
  outputParts = outputParts.concat(toParts.slice(samePartsLength));
  return outputParts.join("/");
 })
};
var TTY = {
 ttys: [],
 init: (function() {}),
 shutdown: (function() {}),
 register: (function(dev, ops) {
  TTY.ttys[dev] = {
   input: [],
   output: [],
   ops: ops
  };
  FS.registerDevice(dev, TTY.stream_ops);
 }),
 stream_ops: {
  open: (function(stream) {
   var tty = TTY.ttys[stream.node.rdev];
   if (!tty) {
    throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
   }
   stream.tty = tty;
   stream.seekable = false;
  }),
  close: (function(stream) {
   stream.tty.ops.flush(stream.tty);
  }),
  flush: (function(stream) {
   stream.tty.ops.flush(stream.tty);
  }),
  read: (function(stream, buffer, offset, length, pos) {
   if (!stream.tty || !stream.tty.ops.get_char) {
    throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
   }
   var bytesRead = 0;
   for (var i = 0; i < length; i++) {
    var result;
    try {
     result = stream.tty.ops.get_char(stream.tty);
    } catch (e) {
     throw new FS.ErrnoError(ERRNO_CODES.EIO);
    }
    if (result === undefined && bytesRead === 0) {
     throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
    }
    if (result === null || result === undefined) break;
    bytesRead++;
    buffer[offset + i] = result;
   }
   if (bytesRead) {
    stream.node.timestamp = Date.now();
   }
   return bytesRead;
  }),
  write: (function(stream, buffer, offset, length, pos) {
   if (!stream.tty || !stream.tty.ops.put_char) {
    throw new FS.ErrnoError(ERRNO_CODES.ENXIO);
   }
   for (var i = 0; i < length; i++) {
    try {
     stream.tty.ops.put_char(stream.tty, buffer[offset + i]);
    } catch (e) {
     throw new FS.ErrnoError(ERRNO_CODES.EIO);
    }
   }
   if (length) {
    stream.node.timestamp = Date.now();
   }
   return i;
  })
 },
 default_tty_ops: {
  get_char: (function(tty) {
   if (!tty.input.length) {
    var result = null;
    if (ENVIRONMENT_IS_NODE) {
     var BUFSIZE = 256;
     var buf = new Buffer(BUFSIZE);
     var bytesRead = 0;
     var isPosixPlatform = process.platform != "win32";
     var fd = process.stdin.fd;
     if (isPosixPlatform) {
      var usingDevice = false;
      try {
       fd = fs.openSync("/dev/stdin", "r");
       usingDevice = true;
      } catch (e) {}
     }
     try {
      bytesRead = fs.readSync(fd, buf, 0, BUFSIZE, null);
     } catch (e) {
      if (e.toString().indexOf("EOF") != -1) bytesRead = 0; else throw e;
     }
     if (usingDevice) {
      fs.closeSync(fd);
     }
     if (bytesRead > 0) {
      result = buf.slice(0, bytesRead).toString("utf-8");
     } else {
      result = null;
     }
    } else if (typeof window != "undefined" && typeof window.prompt == "function") {
     result = window.prompt("Input: ");
     if (result !== null) {
      result += "\n";
     }
    } else if (typeof readline == "function") {
     result = readline();
     if (result !== null) {
      result += "\n";
     }
    }
    if (!result) {
     return null;
    }
    tty.input = intArrayFromString(result, true);
   }
   return tty.input.shift();
  }),
  put_char: (function(tty, val) {
   if (val === null || val === 10) {
    Module["print"](UTF8ArrayToString(tty.output, 0));
    tty.output = [];
   } else {
    if (val != 0) tty.output.push(val);
   }
  }),
  flush: (function(tty) {
   if (tty.output && tty.output.length > 0) {
    Module["print"](UTF8ArrayToString(tty.output, 0));
    tty.output = [];
   }
  })
 },
 default_tty1_ops: {
  put_char: (function(tty, val) {
   if (val === null || val === 10) {
    Module["printErr"](UTF8ArrayToString(tty.output, 0));
    tty.output = [];
   } else {
    if (val != 0) tty.output.push(val);
   }
  }),
  flush: (function(tty) {
   if (tty.output && tty.output.length > 0) {
    Module["printErr"](UTF8ArrayToString(tty.output, 0));
    tty.output = [];
   }
  })
 }
};
var MEMFS = {
 ops_table: null,
 mount: (function(mount) {
  return MEMFS.createNode(null, "/", 16384 | 511, 0);
 }),
 createNode: (function(parent, name, mode, dev) {
  if (FS.isBlkdev(mode) || FS.isFIFO(mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  if (!MEMFS.ops_table) {
   MEMFS.ops_table = {
    dir: {
     node: {
      getattr: MEMFS.node_ops.getattr,
      setattr: MEMFS.node_ops.setattr,
      lookup: MEMFS.node_ops.lookup,
      mknod: MEMFS.node_ops.mknod,
      rename: MEMFS.node_ops.rename,
      unlink: MEMFS.node_ops.unlink,
      rmdir: MEMFS.node_ops.rmdir,
      readdir: MEMFS.node_ops.readdir,
      symlink: MEMFS.node_ops.symlink
     },
     stream: {
      llseek: MEMFS.stream_ops.llseek
     }
    },
    file: {
     node: {
      getattr: MEMFS.node_ops.getattr,
      setattr: MEMFS.node_ops.setattr
     },
     stream: {
      llseek: MEMFS.stream_ops.llseek,
      read: MEMFS.stream_ops.read,
      write: MEMFS.stream_ops.write,
      allocate: MEMFS.stream_ops.allocate,
      mmap: MEMFS.stream_ops.mmap,
      msync: MEMFS.stream_ops.msync
     }
    },
    link: {
     node: {
      getattr: MEMFS.node_ops.getattr,
      setattr: MEMFS.node_ops.setattr,
      readlink: MEMFS.node_ops.readlink
     },
     stream: {}
    },
    chrdev: {
     node: {
      getattr: MEMFS.node_ops.getattr,
      setattr: MEMFS.node_ops.setattr
     },
     stream: FS.chrdev_stream_ops
    }
   };
  }
  var node = FS.createNode(parent, name, mode, dev);
  if (FS.isDir(node.mode)) {
   node.node_ops = MEMFS.ops_table.dir.node;
   node.stream_ops = MEMFS.ops_table.dir.stream;
   node.contents = {};
  } else if (FS.isFile(node.mode)) {
   node.node_ops = MEMFS.ops_table.file.node;
   node.stream_ops = MEMFS.ops_table.file.stream;
   node.usedBytes = 0;
   node.contents = null;
  } else if (FS.isLink(node.mode)) {
   node.node_ops = MEMFS.ops_table.link.node;
   node.stream_ops = MEMFS.ops_table.link.stream;
  } else if (FS.isChrdev(node.mode)) {
   node.node_ops = MEMFS.ops_table.chrdev.node;
   node.stream_ops = MEMFS.ops_table.chrdev.stream;
  }
  node.timestamp = Date.now();
  if (parent) {
   parent.contents[name] = node;
  }
  return node;
 }),
 getFileDataAsRegularArray: (function(node) {
  if (node.contents && node.contents.subarray) {
   var arr = [];
   for (var i = 0; i < node.usedBytes; ++i) arr.push(node.contents[i]);
   return arr;
  }
  return node.contents;
 }),
 getFileDataAsTypedArray: (function(node) {
  if (!node.contents) return new Uint8Array;
  if (node.contents.subarray) return node.contents.subarray(0, node.usedBytes);
  return new Uint8Array(node.contents);
 }),
 expandFileStorage: (function(node, newCapacity) {
  if (node.contents && node.contents.subarray && newCapacity > node.contents.length) {
   node.contents = MEMFS.getFileDataAsRegularArray(node);
   node.usedBytes = node.contents.length;
  }
  if (!node.contents || node.contents.subarray) {
   var prevCapacity = node.contents ? node.contents.length : 0;
   if (prevCapacity >= newCapacity) return;
   var CAPACITY_DOUBLING_MAX = 1024 * 1024;
   newCapacity = Math.max(newCapacity, prevCapacity * (prevCapacity < CAPACITY_DOUBLING_MAX ? 2 : 1.125) | 0);
   if (prevCapacity != 0) newCapacity = Math.max(newCapacity, 256);
   var oldContents = node.contents;
   node.contents = new Uint8Array(newCapacity);
   if (node.usedBytes > 0) node.contents.set(oldContents.subarray(0, node.usedBytes), 0);
   return;
  }
  if (!node.contents && newCapacity > 0) node.contents = [];
  while (node.contents.length < newCapacity) node.contents.push(0);
 }),
 resizeFileStorage: (function(node, newSize) {
  if (node.usedBytes == newSize) return;
  if (newSize == 0) {
   node.contents = null;
   node.usedBytes = 0;
   return;
  }
  if (!node.contents || node.contents.subarray) {
   var oldContents = node.contents;
   node.contents = new Uint8Array(new ArrayBuffer(newSize));
   if (oldContents) {
    node.contents.set(oldContents.subarray(0, Math.min(newSize, node.usedBytes)));
   }
   node.usedBytes = newSize;
   return;
  }
  if (!node.contents) node.contents = [];
  if (node.contents.length > newSize) node.contents.length = newSize; else while (node.contents.length < newSize) node.contents.push(0);
  node.usedBytes = newSize;
 }),
 node_ops: {
  getattr: (function(node) {
   var attr = {};
   attr.dev = FS.isChrdev(node.mode) ? node.id : 1;
   attr.ino = node.id;
   attr.mode = node.mode;
   attr.nlink = 1;
   attr.uid = 0;
   attr.gid = 0;
   attr.rdev = node.rdev;
   if (FS.isDir(node.mode)) {
    attr.size = 4096;
   } else if (FS.isFile(node.mode)) {
    attr.size = node.usedBytes;
   } else if (FS.isLink(node.mode)) {
    attr.size = node.link.length;
   } else {
    attr.size = 0;
   }
   attr.atime = new Date(node.timestamp);
   attr.mtime = new Date(node.timestamp);
   attr.ctime = new Date(node.timestamp);
   attr.blksize = 4096;
   attr.blocks = Math.ceil(attr.size / attr.blksize);
   return attr;
  }),
  setattr: (function(node, attr) {
   if (attr.mode !== undefined) {
    node.mode = attr.mode;
   }
   if (attr.timestamp !== undefined) {
    node.timestamp = attr.timestamp;
   }
   if (attr.size !== undefined) {
    MEMFS.resizeFileStorage(node, attr.size);
   }
  }),
  lookup: (function(parent, name) {
   throw FS.genericErrors[ERRNO_CODES.ENOENT];
  }),
  mknod: (function(parent, name, mode, dev) {
   return MEMFS.createNode(parent, name, mode, dev);
  }),
  rename: (function(old_node, new_dir, new_name) {
   if (FS.isDir(old_node.mode)) {
    var new_node;
    try {
     new_node = FS.lookupNode(new_dir, new_name);
    } catch (e) {}
    if (new_node) {
     for (var i in new_node.contents) {
      throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
     }
    }
   }
   delete old_node.parent.contents[old_node.name];
   old_node.name = new_name;
   new_dir.contents[new_name] = old_node;
   old_node.parent = new_dir;
  }),
  unlink: (function(parent, name) {
   delete parent.contents[name];
  }),
  rmdir: (function(parent, name) {
   var node = FS.lookupNode(parent, name);
   for (var i in node.contents) {
    throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
   }
   delete parent.contents[name];
  }),
  readdir: (function(node) {
   var entries = [ ".", ".." ];
   for (var key in node.contents) {
    if (!node.contents.hasOwnProperty(key)) {
     continue;
    }
    entries.push(key);
   }
   return entries;
  }),
  symlink: (function(parent, newname, oldpath) {
   var node = MEMFS.createNode(parent, newname, 511 | 40960, 0);
   node.link = oldpath;
   return node;
  }),
  readlink: (function(node) {
   if (!FS.isLink(node.mode)) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   return node.link;
  })
 },
 stream_ops: {
  read: (function(stream, buffer, offset, length, position) {
   var contents = stream.node.contents;
   if (position >= stream.node.usedBytes) return 0;
   var size = Math.min(stream.node.usedBytes - position, length);
   assert(size >= 0);
   if (size > 8 && contents.subarray) {
    buffer.set(contents.subarray(position, position + size), offset);
   } else {
    for (var i = 0; i < size; i++) buffer[offset + i] = contents[position + i];
   }
   return size;
  }),
  write: (function(stream, buffer, offset, length, position, canOwn) {
   if (!length) return 0;
   var node = stream.node;
   node.timestamp = Date.now();
   if (buffer.subarray && (!node.contents || node.contents.subarray)) {
    if (canOwn) {
     assert(position === 0, "canOwn must imply no weird position inside the file");
     node.contents = buffer.subarray(offset, offset + length);
     node.usedBytes = length;
     return length;
    } else if (node.usedBytes === 0 && position === 0) {
     node.contents = new Uint8Array(buffer.subarray(offset, offset + length));
     node.usedBytes = length;
     return length;
    } else if (position + length <= node.usedBytes) {
     node.contents.set(buffer.subarray(offset, offset + length), position);
     return length;
    }
   }
   MEMFS.expandFileStorage(node, position + length);
   if (node.contents.subarray && buffer.subarray) node.contents.set(buffer.subarray(offset, offset + length), position); else {
    for (var i = 0; i < length; i++) {
     node.contents[position + i] = buffer[offset + i];
    }
   }
   node.usedBytes = Math.max(node.usedBytes, position + length);
   return length;
  }),
  llseek: (function(stream, offset, whence) {
   var position = offset;
   if (whence === 1) {
    position += stream.position;
   } else if (whence === 2) {
    if (FS.isFile(stream.node.mode)) {
     position += stream.node.usedBytes;
    }
   }
   if (position < 0) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   return position;
  }),
  allocate: (function(stream, offset, length) {
   MEMFS.expandFileStorage(stream.node, offset + length);
   stream.node.usedBytes = Math.max(stream.node.usedBytes, offset + length);
  }),
  mmap: (function(stream, buffer, offset, length, position, prot, flags) {
   if (!FS.isFile(stream.node.mode)) {
    throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
   }
   var ptr;
   var allocated;
   var contents = stream.node.contents;
   if (!(flags & 2) && (contents.buffer === buffer || contents.buffer === buffer.buffer)) {
    allocated = false;
    ptr = contents.byteOffset;
   } else {
    if (position > 0 || position + length < stream.node.usedBytes) {
     if (contents.subarray) {
      contents = contents.subarray(position, position + length);
     } else {
      contents = Array.prototype.slice.call(contents, position, position + length);
     }
    }
    allocated = true;
    ptr = _malloc(length);
    if (!ptr) {
     throw new FS.ErrnoError(ERRNO_CODES.ENOMEM);
    }
    buffer.set(contents, ptr);
   }
   return {
    ptr: ptr,
    allocated: allocated
   };
  }),
  msync: (function(stream, buffer, offset, length, mmapFlags) {
   if (!FS.isFile(stream.node.mode)) {
    throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
   }
   if (mmapFlags & 2) {
    return 0;
   }
   var bytesWritten = MEMFS.stream_ops.write(stream, buffer, 0, length, offset, false);
   return 0;
  })
 }
};
var IDBFS = {
 dbs: {},
 indexedDB: (function() {
  return Module.indexedDB;
 }),
 DB_VERSION: 21,
 DB_STORE_NAME: "FILE_DATA",
 mount: (function(mount) {
  return MEMFS.mount.apply(null, arguments);
 }),
 syncfs: (function(mount, populate, callback) {
  IDBFS.getLocalSet(mount, (function(err, local) {
   if (err) return callback(err);
   IDBFS.getRemoteSet(mount, (function(err, remote) {
    if (err) return callback(err);
    var src = populate ? remote : local;
    var dst = populate ? local : remote;
    IDBFS.reconcile(src, dst, callback);
   }));
  }));
 }),
 getDB: (function(name, callback) {
  var db = IDBFS.dbs[name];
  if (db) {
   return callback(null, db);
  }
  var req;
  try {
   req = IDBFS.indexedDB().open(name, IDBFS.DB_VERSION);
  } catch (e) {
   return callback(e);
  }
  if (!req) {
   return callback("Unable to connect to IndexedDB");
  }
  req.onupgradeneeded = (function(e) {
   var db = e.target.result;
   var transaction = e.target.transaction;
   var fileStore;
   if (db.objectStoreNames.contains(IDBFS.DB_STORE_NAME)) {
    fileStore = transaction.objectStore(IDBFS.DB_STORE_NAME);
   } else {
    fileStore = db.createObjectStore(IDBFS.DB_STORE_NAME);
   }
   if (!fileStore.indexNames.contains("timestamp")) {
    fileStore.createIndex("timestamp", "timestamp", {
     unique: false
    });
   }
  });
  req.onsuccess = (function() {
   db = req.result;
   IDBFS.dbs[name] = db;
   callback(null, db);
  });
  req.onerror = (function(e) {
   callback(this.error);
   e.preventDefault();
  });
 }),
 getLocalSet: (function(mount, callback) {
  var entries = {};
  function isRealDir(p) {
   return p !== "." && p !== "..";
  }
  function toAbsolute(root) {
   return (function(p) {
    return PATH.join2(root, p);
   });
  }
  var check = FS.readdir(mount.mountpoint).filter(isRealDir).map(toAbsolute(mount.mountpoint));
  while (check.length) {
   var path = check.pop();
   var stat;
   try {
    stat = FS.stat(path);
   } catch (e) {
    return callback(e);
   }
   if (FS.isDir(stat.mode)) {
    check.push.apply(check, FS.readdir(path).filter(isRealDir).map(toAbsolute(path)));
   }
   entries[path] = {
    timestamp: stat.mtime
   };
  }
  return callback(null, {
   type: "local",
   entries: entries
  });
 }),
 getRemoteSet: (function(mount, callback) {
  var entries = {};
  IDBFS.getDB(mount.mountpoint, (function(err, db) {
   if (err) return callback(err);
   var transaction = db.transaction([ IDBFS.DB_STORE_NAME ], "readonly");
   transaction.onerror = (function(e) {
    callback(this.error);
    e.preventDefault();
   });
   var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
   var index = store.index("timestamp");
   index.openKeyCursor().onsuccess = (function(event) {
    var cursor = event.target.result;
    if (!cursor) {
     return callback(null, {
      type: "remote",
      db: db,
      entries: entries
     });
    }
    entries[cursor.primaryKey] = {
     timestamp: cursor.key
    };
    cursor.continue();
   });
  }));
 }),
 loadLocalEntry: (function(path, callback) {
  var stat, node;
  try {
   var lookup = FS.lookupPath(path);
   node = lookup.node;
   stat = FS.stat(path);
  } catch (e) {
   return callback(e);
  }
  if (FS.isDir(stat.mode)) {
   return callback(null, {
    timestamp: stat.mtime,
    mode: stat.mode
   });
  } else if (FS.isFile(stat.mode)) {
   node.contents = MEMFS.getFileDataAsTypedArray(node);
   return callback(null, {
    timestamp: stat.mtime,
    mode: stat.mode,
    contents: node.contents
   });
  } else {
   return callback(new Error("node type not supported"));
  }
 }),
 storeLocalEntry: (function(path, entry, callback) {
  try {
   if (FS.isDir(entry.mode)) {
    FS.mkdir(path, entry.mode);
   } else if (FS.isFile(entry.mode)) {
    FS.writeFile(path, entry.contents, {
     encoding: "binary",
     canOwn: true
    });
   } else {
    return callback(new Error("node type not supported"));
   }
   FS.chmod(path, entry.mode);
   FS.utime(path, entry.timestamp, entry.timestamp);
  } catch (e) {
   return callback(e);
  }
  callback(null);
 }),
 removeLocalEntry: (function(path, callback) {
  try {
   var lookup = FS.lookupPath(path);
   var stat = FS.stat(path);
   if (FS.isDir(stat.mode)) {
    FS.rmdir(path);
   } else if (FS.isFile(stat.mode)) {
    FS.unlink(path);
   }
  } catch (e) {
   return callback(e);
  }
  callback(null);
 }),
 loadRemoteEntry: (function(store, path, callback) {
  var req = store.get(path);
  req.onsuccess = (function(event) {
   callback(null, event.target.result);
  });
  req.onerror = (function(e) {
   callback(this.error);
   e.preventDefault();
  });
 }),
 storeRemoteEntry: (function(store, path, entry, callback) {
  var req = store.put(entry, path);
  req.onsuccess = (function() {
   callback(null);
  });
  req.onerror = (function(e) {
   callback(this.error);
   e.preventDefault();
  });
 }),
 removeRemoteEntry: (function(store, path, callback) {
  var req = store.delete(path);
  req.onsuccess = (function() {
   callback(null);
  });
  req.onerror = (function(e) {
   callback(this.error);
   e.preventDefault();
  });
 }),
 reconcile: (function(src, dst, callback) {
  var total = 0;
  var create = [];
  Object.keys(src.entries).forEach((function(key) {
   var e = src.entries[key];
   var e2 = dst.entries[key];
   if (!e2 || e.timestamp > e2.timestamp) {
    create.push(key);
    total++;
   }
  }));
  var remove = [];
  Object.keys(dst.entries).forEach((function(key) {
   var e = dst.entries[key];
   var e2 = src.entries[key];
   if (!e2) {
    remove.push(key);
    total++;
   }
  }));
  if (!total) {
   return callback(null);
  }
  var completed = 0;
  var db = src.type === "remote" ? src.db : dst.db;
  var transaction = db.transaction([ IDBFS.DB_STORE_NAME ], "readwrite");
  var store = transaction.objectStore(IDBFS.DB_STORE_NAME);
  function done(err) {
   if (err) {
    if (!done.errored) {
     done.errored = true;
     return callback(err);
    }
    return;
   }
   if (++completed >= total) {
    return callback(null);
   }
  }
  transaction.onerror = (function(e) {
   done(this.error);
   e.preventDefault();
  });
  create.sort().forEach((function(path) {
   if (dst.type === "local") {
    IDBFS.loadRemoteEntry(store, path, (function(err, entry) {
     if (err) return done(err);
     IDBFS.storeLocalEntry(path, entry, done);
    }));
   } else {
    IDBFS.loadLocalEntry(path, (function(err, entry) {
     if (err) return done(err);
     IDBFS.storeRemoteEntry(store, path, entry, done);
    }));
   }
  }));
  remove.sort().reverse().forEach((function(path) {
   if (dst.type === "local") {
    IDBFS.removeLocalEntry(path, done);
   } else {
    IDBFS.removeRemoteEntry(store, path, done);
   }
  }));
 })
};
var NODEFS = {
 isWindows: false,
 staticInit: (function() {
  NODEFS.isWindows = !!process.platform.match(/^win/);
 }),
 mount: (function(mount) {
  assert(ENVIRONMENT_IS_NODE);
  return NODEFS.createNode(null, "/", NODEFS.getMode(mount.opts.root), 0);
 }),
 createNode: (function(parent, name, mode, dev) {
  if (!FS.isDir(mode) && !FS.isFile(mode) && !FS.isLink(mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var node = FS.createNode(parent, name, mode);
  node.node_ops = NODEFS.node_ops;
  node.stream_ops = NODEFS.stream_ops;
  return node;
 }),
 getMode: (function(path) {
  var stat;
  try {
   stat = fs.lstatSync(path);
   if (NODEFS.isWindows) {
    stat.mode = stat.mode | (stat.mode & 146) >> 1;
   }
  } catch (e) {
   if (!e.code) throw e;
   throw new FS.ErrnoError(ERRNO_CODES[e.code]);
  }
  return stat.mode;
 }),
 realPath: (function(node) {
  var parts = [];
  while (node.parent !== node) {
   parts.push(node.name);
   node = node.parent;
  }
  parts.push(node.mount.opts.root);
  parts.reverse();
  return PATH.join.apply(null, parts);
 }),
 flagsToPermissionStringMap: {
  0: "r",
  1: "r+",
  2: "r+",
  64: "r",
  65: "r+",
  66: "r+",
  129: "rx+",
  193: "rx+",
  514: "w+",
  577: "w",
  578: "w+",
  705: "wx",
  706: "wx+",
  1024: "a",
  1025: "a",
  1026: "a+",
  1089: "a",
  1090: "a+",
  1153: "ax",
  1154: "ax+",
  1217: "ax",
  1218: "ax+",
  4096: "rs",
  4098: "rs+"
 },
 flagsToPermissionString: (function(flags) {
  flags &= ~2097152;
  flags &= ~2048;
  flags &= ~32768;
  flags &= ~524288;
  if (flags in NODEFS.flagsToPermissionStringMap) {
   return NODEFS.flagsToPermissionStringMap[flags];
  } else {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
 }),
 node_ops: {
  getattr: (function(node) {
   var path = NODEFS.realPath(node);
   var stat;
   try {
    stat = fs.lstatSync(path);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
   if (NODEFS.isWindows && !stat.blksize) {
    stat.blksize = 4096;
   }
   if (NODEFS.isWindows && !stat.blocks) {
    stat.blocks = (stat.size + stat.blksize - 1) / stat.blksize | 0;
   }
   return {
    dev: stat.dev,
    ino: stat.ino,
    mode: stat.mode,
    nlink: stat.nlink,
    uid: stat.uid,
    gid: stat.gid,
    rdev: stat.rdev,
    size: stat.size,
    atime: stat.atime,
    mtime: stat.mtime,
    ctime: stat.ctime,
    blksize: stat.blksize,
    blocks: stat.blocks
   };
  }),
  setattr: (function(node, attr) {
   var path = NODEFS.realPath(node);
   try {
    if (attr.mode !== undefined) {
     fs.chmodSync(path, attr.mode);
     node.mode = attr.mode;
    }
    if (attr.timestamp !== undefined) {
     var date = new Date(attr.timestamp);
     fs.utimesSync(path, date, date);
    }
    if (attr.size !== undefined) {
     fs.truncateSync(path, attr.size);
    }
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  lookup: (function(parent, name) {
   var path = PATH.join2(NODEFS.realPath(parent), name);
   var mode = NODEFS.getMode(path);
   return NODEFS.createNode(parent, name, mode);
  }),
  mknod: (function(parent, name, mode, dev) {
   var node = NODEFS.createNode(parent, name, mode, dev);
   var path = NODEFS.realPath(node);
   try {
    if (FS.isDir(node.mode)) {
     fs.mkdirSync(path, node.mode);
    } else {
     fs.writeFileSync(path, "", {
      mode: node.mode
     });
    }
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
   return node;
  }),
  rename: (function(oldNode, newDir, newName) {
   var oldPath = NODEFS.realPath(oldNode);
   var newPath = PATH.join2(NODEFS.realPath(newDir), newName);
   try {
    fs.renameSync(oldPath, newPath);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  unlink: (function(parent, name) {
   var path = PATH.join2(NODEFS.realPath(parent), name);
   try {
    fs.unlinkSync(path);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  rmdir: (function(parent, name) {
   var path = PATH.join2(NODEFS.realPath(parent), name);
   try {
    fs.rmdirSync(path);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  readdir: (function(node) {
   var path = NODEFS.realPath(node);
   try {
    return fs.readdirSync(path);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  symlink: (function(parent, newName, oldPath) {
   var newPath = PATH.join2(NODEFS.realPath(parent), newName);
   try {
    fs.symlinkSync(oldPath, newPath);
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  readlink: (function(node) {
   var path = NODEFS.realPath(node);
   try {
    path = fs.readlinkSync(path);
    path = NODEJS_PATH.relative(NODEJS_PATH.resolve(node.mount.opts.root), path);
    return path;
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  })
 },
 stream_ops: {
  open: (function(stream) {
   var path = NODEFS.realPath(stream.node);
   try {
    if (FS.isFile(stream.node.mode)) {
     stream.nfd = fs.openSync(path, NODEFS.flagsToPermissionString(stream.flags));
    }
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  close: (function(stream) {
   try {
    if (FS.isFile(stream.node.mode) && stream.nfd) {
     fs.closeSync(stream.nfd);
    }
   } catch (e) {
    if (!e.code) throw e;
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
  }),
  read: (function(stream, buffer, offset, length, position) {
   if (length === 0) return 0;
   var nbuffer = new Buffer(length);
   var res;
   try {
    res = fs.readSync(stream.nfd, nbuffer, 0, length, position);
   } catch (e) {
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
   if (res > 0) {
    for (var i = 0; i < res; i++) {
     buffer[offset + i] = nbuffer[i];
    }
   }
   return res;
  }),
  write: (function(stream, buffer, offset, length, position) {
   var nbuffer = new Buffer(buffer.subarray(offset, offset + length));
   var res;
   try {
    res = fs.writeSync(stream.nfd, nbuffer, 0, length, position);
   } catch (e) {
    throw new FS.ErrnoError(ERRNO_CODES[e.code]);
   }
   return res;
  }),
  llseek: (function(stream, offset, whence) {
   var position = offset;
   if (whence === 1) {
    position += stream.position;
   } else if (whence === 2) {
    if (FS.isFile(stream.node.mode)) {
     try {
      var stat = fs.fstatSync(stream.nfd);
      position += stat.size;
     } catch (e) {
      throw new FS.ErrnoError(ERRNO_CODES[e.code]);
     }
    }
   }
   if (position < 0) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   return position;
  })
 }
};
var WORKERFS = {
 DIR_MODE: 16895,
 FILE_MODE: 33279,
 reader: null,
 mount: (function(mount) {
  assert(ENVIRONMENT_IS_WORKER);
  if (!WORKERFS.reader) WORKERFS.reader = new FileReaderSync;
  var root = WORKERFS.createNode(null, "/", WORKERFS.DIR_MODE, 0);
  var createdParents = {};
  function ensureParent(path) {
   var parts = path.split("/");
   var parent = root;
   for (var i = 0; i < parts.length - 1; i++) {
    var curr = parts.slice(0, i + 1).join("/");
    if (!createdParents[curr]) {
     createdParents[curr] = WORKERFS.createNode(parent, parts[i], WORKERFS.DIR_MODE, 0);
    }
    parent = createdParents[curr];
   }
   return parent;
  }
  function base(path) {
   var parts = path.split("/");
   return parts[parts.length - 1];
  }
  Array.prototype.forEach.call(mount.opts["files"] || [], (function(file) {
   WORKERFS.createNode(ensureParent(file.name), base(file.name), WORKERFS.FILE_MODE, 0, file, file.lastModifiedDate);
  }));
  (mount.opts["blobs"] || []).forEach((function(obj) {
   WORKERFS.createNode(ensureParent(obj["name"]), base(obj["name"]), WORKERFS.FILE_MODE, 0, obj["data"]);
  }));
  (mount.opts["packages"] || []).forEach((function(pack) {
   pack["metadata"].files.forEach((function(file) {
    var name = file.filename.substr(1);
    WORKERFS.createNode(ensureParent(name), base(name), WORKERFS.FILE_MODE, 0, pack["blob"].slice(file.start, file.end));
   }));
  }));
  return root;
 }),
 createNode: (function(parent, name, mode, dev, contents, mtime) {
  var node = FS.createNode(parent, name, mode);
  node.mode = mode;
  node.node_ops = WORKERFS.node_ops;
  node.stream_ops = WORKERFS.stream_ops;
  node.timestamp = (mtime || new Date).getTime();
  assert(WORKERFS.FILE_MODE !== WORKERFS.DIR_MODE);
  if (mode === WORKERFS.FILE_MODE) {
   node.size = contents.size;
   node.contents = contents;
  } else {
   node.size = 4096;
   node.contents = {};
  }
  if (parent) {
   parent.contents[name] = node;
  }
  return node;
 }),
 node_ops: {
  getattr: (function(node) {
   return {
    dev: 1,
    ino: undefined,
    mode: node.mode,
    nlink: 1,
    uid: 0,
    gid: 0,
    rdev: undefined,
    size: node.size,
    atime: new Date(node.timestamp),
    mtime: new Date(node.timestamp),
    ctime: new Date(node.timestamp),
    blksize: 4096,
    blocks: Math.ceil(node.size / 4096)
   };
  }),
  setattr: (function(node, attr) {
   if (attr.mode !== undefined) {
    node.mode = attr.mode;
   }
   if (attr.timestamp !== undefined) {
    node.timestamp = attr.timestamp;
   }
  }),
  lookup: (function(parent, name) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }),
  mknod: (function(parent, name, mode, dev) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  rename: (function(oldNode, newDir, newName) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  unlink: (function(parent, name) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  rmdir: (function(parent, name) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  readdir: (function(node) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  symlink: (function(parent, newName, oldPath) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }),
  readlink: (function(node) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  })
 },
 stream_ops: {
  read: (function(stream, buffer, offset, length, position) {
   if (position >= stream.node.size) return 0;
   var chunk = stream.node.contents.slice(position, position + length);
   var ab = WORKERFS.reader.readAsArrayBuffer(chunk);
   buffer.set(new Uint8Array(ab), offset);
   return chunk.size;
  }),
  write: (function(stream, buffer, offset, length, position) {
   throw new FS.ErrnoError(ERRNO_CODES.EIO);
  }),
  llseek: (function(stream, offset, whence) {
   var position = offset;
   if (whence === 1) {
    position += stream.position;
   } else if (whence === 2) {
    if (FS.isFile(stream.node.mode)) {
     position += stream.node.size;
    }
   }
   if (position < 0) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   return position;
  })
 }
};
STATICTOP += 16;
STATICTOP += 16;
STATICTOP += 16;
var FS = {
 root: null,
 mounts: [],
 devices: [ null ],
 streams: [],
 nextInode: 1,
 nameTable: null,
 currentPath: "/",
 initialized: false,
 ignorePermissions: true,
 trackingDelegate: {},
 tracking: {
  openFlags: {
   READ: 1,
   WRITE: 2
  }
 },
 ErrnoError: null,
 genericErrors: {},
 filesystems: null,
 syncFSRequests: 0,
 handleFSError: (function(e) {
  if (!(e instanceof FS.ErrnoError)) throw e + " : " + stackTrace();
  return ___setErrNo(e.errno);
 }),
 lookupPath: (function(path, opts) {
  path = PATH.resolve(FS.cwd(), path);
  opts = opts || {};
  if (!path) return {
   path: "",
   node: null
  };
  var defaults = {
   follow_mount: true,
   recurse_count: 0
  };
  for (var key in defaults) {
   if (opts[key] === undefined) {
    opts[key] = defaults[key];
   }
  }
  if (opts.recurse_count > 8) {
   throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
  }
  var parts = PATH.normalizeArray(path.split("/").filter((function(p) {
   return !!p;
  })), false);
  var current = FS.root;
  var current_path = "/";
  for (var i = 0; i < parts.length; i++) {
   var islast = i === parts.length - 1;
   if (islast && opts.parent) {
    break;
   }
   current = FS.lookupNode(current, parts[i]);
   current_path = PATH.join2(current_path, parts[i]);
   if (FS.isMountpoint(current)) {
    if (!islast || islast && opts.follow_mount) {
     current = current.mounted.root;
    }
   }
   if (!islast || opts.follow) {
    var count = 0;
    while (FS.isLink(current.mode)) {
     var link = FS.readlink(current_path);
     current_path = PATH.resolve(PATH.dirname(current_path), link);
     var lookup = FS.lookupPath(current_path, {
      recurse_count: opts.recurse_count
     });
     current = lookup.node;
     if (count++ > 40) {
      throw new FS.ErrnoError(ERRNO_CODES.ELOOP);
     }
    }
   }
  }
  return {
   path: current_path,
   node: current
  };
 }),
 getPath: (function(node) {
  var path;
  while (true) {
   if (FS.isRoot(node)) {
    var mount = node.mount.mountpoint;
    if (!path) return mount;
    return mount[mount.length - 1] !== "/" ? mount + "/" + path : mount + path;
   }
   path = path ? node.name + "/" + path : node.name;
   node = node.parent;
  }
 }),
 hashName: (function(parentid, name) {
  var hash = 0;
  for (var i = 0; i < name.length; i++) {
   hash = (hash << 5) - hash + name.charCodeAt(i) | 0;
  }
  return (parentid + hash >>> 0) % FS.nameTable.length;
 }),
 hashAddNode: (function(node) {
  var hash = FS.hashName(node.parent.id, node.name);
  node.name_next = FS.nameTable[hash];
  FS.nameTable[hash] = node;
 }),
 hashRemoveNode: (function(node) {
  var hash = FS.hashName(node.parent.id, node.name);
  if (FS.nameTable[hash] === node) {
   FS.nameTable[hash] = node.name_next;
  } else {
   var current = FS.nameTable[hash];
   while (current) {
    if (current.name_next === node) {
     current.name_next = node.name_next;
     break;
    }
    current = current.name_next;
   }
  }
 }),
 lookupNode: (function(parent, name) {
  var err = FS.mayLookup(parent);
  if (err) {
   throw new FS.ErrnoError(err, parent);
  }
  var hash = FS.hashName(parent.id, name);
  for (var node = FS.nameTable[hash]; node; node = node.name_next) {
   var nodeName = node.name;
   if (node.parent.id === parent.id && nodeName === name) {
    return node;
   }
  }
  return FS.lookup(parent, name);
 }),
 createNode: (function(parent, name, mode, rdev) {
  if (!FS.FSNode) {
   FS.FSNode = (function(parent, name, mode, rdev) {
    if (!parent) {
     parent = this;
    }
    this.parent = parent;
    this.mount = parent.mount;
    this.mounted = null;
    this.id = FS.nextInode++;
    this.name = name;
    this.mode = mode;
    this.node_ops = {};
    this.stream_ops = {};
    this.rdev = rdev;
   });
   FS.FSNode.prototype = {};
   var readMode = 292 | 73;
   var writeMode = 146;
   Object.defineProperties(FS.FSNode.prototype, {
    read: {
     get: (function() {
      return (this.mode & readMode) === readMode;
     }),
     set: (function(val) {
      val ? this.mode |= readMode : this.mode &= ~readMode;
     })
    },
    write: {
     get: (function() {
      return (this.mode & writeMode) === writeMode;
     }),
     set: (function(val) {
      val ? this.mode |= writeMode : this.mode &= ~writeMode;
     })
    },
    isFolder: {
     get: (function() {
      return FS.isDir(this.mode);
     })
    },
    isDevice: {
     get: (function() {
      return FS.isChrdev(this.mode);
     })
    }
   });
  }
  var node = new FS.FSNode(parent, name, mode, rdev);
  FS.hashAddNode(node);
  return node;
 }),
 destroyNode: (function(node) {
  FS.hashRemoveNode(node);
 }),
 isRoot: (function(node) {
  return node === node.parent;
 }),
 isMountpoint: (function(node) {
  return !!node.mounted;
 }),
 isFile: (function(mode) {
  return (mode & 61440) === 32768;
 }),
 isDir: (function(mode) {
  return (mode & 61440) === 16384;
 }),
 isLink: (function(mode) {
  return (mode & 61440) === 40960;
 }),
 isChrdev: (function(mode) {
  return (mode & 61440) === 8192;
 }),
 isBlkdev: (function(mode) {
  return (mode & 61440) === 24576;
 }),
 isFIFO: (function(mode) {
  return (mode & 61440) === 4096;
 }),
 isSocket: (function(mode) {
  return (mode & 49152) === 49152;
 }),
 flagModes: {
  "r": 0,
  "rs": 1052672,
  "r+": 2,
  "w": 577,
  "wx": 705,
  "xw": 705,
  "w+": 578,
  "wx+": 706,
  "xw+": 706,
  "a": 1089,
  "ax": 1217,
  "xa": 1217,
  "a+": 1090,
  "ax+": 1218,
  "xa+": 1218
 },
 modeStringToFlags: (function(str) {
  var flags = FS.flagModes[str];
  if (typeof flags === "undefined") {
   throw new Error("Unknown file open mode: " + str);
  }
  return flags;
 }),
 flagsToPermissionString: (function(flag) {
  var perms = [ "r", "w", "rw" ][flag & 3];
  if (flag & 512) {
   perms += "w";
  }
  return perms;
 }),
 nodePermissions: (function(node, perms) {
  if (FS.ignorePermissions) {
   return 0;
  }
  if (perms.indexOf("r") !== -1 && !(node.mode & 292)) {
   return ERRNO_CODES.EACCES;
  } else if (perms.indexOf("w") !== -1 && !(node.mode & 146)) {
   return ERRNO_CODES.EACCES;
  } else if (perms.indexOf("x") !== -1 && !(node.mode & 73)) {
   return ERRNO_CODES.EACCES;
  }
  return 0;
 }),
 mayLookup: (function(dir) {
  var err = FS.nodePermissions(dir, "x");
  if (err) return err;
  if (!dir.node_ops.lookup) return ERRNO_CODES.EACCES;
  return 0;
 }),
 mayCreate: (function(dir, name) {
  try {
   var node = FS.lookupNode(dir, name);
   return ERRNO_CODES.EEXIST;
  } catch (e) {}
  return FS.nodePermissions(dir, "wx");
 }),
 mayDelete: (function(dir, name, isdir) {
  var node;
  try {
   node = FS.lookupNode(dir, name);
  } catch (e) {
   return e.errno;
  }
  var err = FS.nodePermissions(dir, "wx");
  if (err) {
   return err;
  }
  if (isdir) {
   if (!FS.isDir(node.mode)) {
    return ERRNO_CODES.ENOTDIR;
   }
   if (FS.isRoot(node) || FS.getPath(node) === FS.cwd()) {
    return ERRNO_CODES.EBUSY;
   }
  } else {
   if (FS.isDir(node.mode)) {
    return ERRNO_CODES.EISDIR;
   }
  }
  return 0;
 }),
 mayOpen: (function(node, flags) {
  if (!node) {
   return ERRNO_CODES.ENOENT;
  }
  if (FS.isLink(node.mode)) {
   return ERRNO_CODES.ELOOP;
  } else if (FS.isDir(node.mode)) {
   if (FS.flagsToPermissionString(flags) !== "r" || flags & 512) {
    return ERRNO_CODES.EISDIR;
   }
  }
  return FS.nodePermissions(node, FS.flagsToPermissionString(flags));
 }),
 MAX_OPEN_FDS: 4096,
 nextfd: (function(fd_start, fd_end) {
  fd_start = fd_start || 0;
  fd_end = fd_end || FS.MAX_OPEN_FDS;
  for (var fd = fd_start; fd <= fd_end; fd++) {
   if (!FS.streams[fd]) {
    return fd;
   }
  }
  throw new FS.ErrnoError(ERRNO_CODES.EMFILE);
 }),
 getStream: (function(fd) {
  return FS.streams[fd];
 }),
 createStream: (function(stream, fd_start, fd_end) {
  if (!FS.FSStream) {
   FS.FSStream = (function() {});
   FS.FSStream.prototype = {};
   Object.defineProperties(FS.FSStream.prototype, {
    object: {
     get: (function() {
      return this.node;
     }),
     set: (function(val) {
      this.node = val;
     })
    },
    isRead: {
     get: (function() {
      return (this.flags & 2097155) !== 1;
     })
    },
    isWrite: {
     get: (function() {
      return (this.flags & 2097155) !== 0;
     })
    },
    isAppend: {
     get: (function() {
      return this.flags & 1024;
     })
    }
   });
  }
  var newStream = new FS.FSStream;
  for (var p in stream) {
   newStream[p] = stream[p];
  }
  stream = newStream;
  var fd = FS.nextfd(fd_start, fd_end);
  stream.fd = fd;
  FS.streams[fd] = stream;
  return stream;
 }),
 closeStream: (function(fd) {
  FS.streams[fd] = null;
 }),
 chrdev_stream_ops: {
  open: (function(stream) {
   var device = FS.getDevice(stream.node.rdev);
   stream.stream_ops = device.stream_ops;
   if (stream.stream_ops.open) {
    stream.stream_ops.open(stream);
   }
  }),
  llseek: (function() {
   throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
  })
 },
 major: (function(dev) {
  return dev >> 8;
 }),
 minor: (function(dev) {
  return dev & 255;
 }),
 makedev: (function(ma, mi) {
  return ma << 8 | mi;
 }),
 registerDevice: (function(dev, ops) {
  FS.devices[dev] = {
   stream_ops: ops
  };
 }),
 getDevice: (function(dev) {
  return FS.devices[dev];
 }),
 getMounts: (function(mount) {
  var mounts = [];
  var check = [ mount ];
  while (check.length) {
   var m = check.pop();
   mounts.push(m);
   check.push.apply(check, m.mounts);
  }
  return mounts;
 }),
 syncfs: (function(populate, callback) {
  if (typeof populate === "function") {
   callback = populate;
   populate = false;
  }
  FS.syncFSRequests++;
  if (FS.syncFSRequests > 1) {
   console.log("warning: " + FS.syncFSRequests + " FS.syncfs operations in flight at once, probably just doing extra work");
  }
  var mounts = FS.getMounts(FS.root.mount);
  var completed = 0;
  function doCallback(err) {
   assert(FS.syncFSRequests > 0);
   FS.syncFSRequests--;
   return callback(err);
  }
  function done(err) {
   if (err) {
    if (!done.errored) {
     done.errored = true;
     return doCallback(err);
    }
    return;
   }
   if (++completed >= mounts.length) {
    doCallback(null);
   }
  }
  mounts.forEach((function(mount) {
   if (!mount.type.syncfs) {
    return done(null);
   }
   mount.type.syncfs(mount, populate, done);
  }));
 }),
 mount: (function(type, opts, mountpoint) {
  var root = mountpoint === "/";
  var pseudo = !mountpoint;
  var node;
  if (root && FS.root) {
   throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
  } else if (!root && !pseudo) {
   var lookup = FS.lookupPath(mountpoint, {
    follow_mount: false
   });
   mountpoint = lookup.path;
   node = lookup.node;
   if (FS.isMountpoint(node)) {
    throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
   }
   if (!FS.isDir(node.mode)) {
    throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
   }
  }
  var mount = {
   type: type,
   opts: opts,
   mountpoint: mountpoint,
   mounts: []
  };
  var mountRoot = type.mount(mount);
  mountRoot.mount = mount;
  mount.root = mountRoot;
  if (root) {
   FS.root = mountRoot;
  } else if (node) {
   node.mounted = mount;
   if (node.mount) {
    node.mount.mounts.push(mount);
   }
  }
  return mountRoot;
 }),
 unmount: (function(mountpoint) {
  var lookup = FS.lookupPath(mountpoint, {
   follow_mount: false
  });
  if (!FS.isMountpoint(lookup.node)) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var node = lookup.node;
  var mount = node.mounted;
  var mounts = FS.getMounts(mount);
  Object.keys(FS.nameTable).forEach((function(hash) {
   var current = FS.nameTable[hash];
   while (current) {
    var next = current.name_next;
    if (mounts.indexOf(current.mount) !== -1) {
     FS.destroyNode(current);
    }
    current = next;
   }
  }));
  node.mounted = null;
  var idx = node.mount.mounts.indexOf(mount);
  assert(idx !== -1);
  node.mount.mounts.splice(idx, 1);
 }),
 lookup: (function(parent, name) {
  return parent.node_ops.lookup(parent, name);
 }),
 mknod: (function(path, mode, dev) {
  var lookup = FS.lookupPath(path, {
   parent: true
  });
  var parent = lookup.node;
  var name = PATH.basename(path);
  if (!name || name === "." || name === "..") {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var err = FS.mayCreate(parent, name);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  if (!parent.node_ops.mknod) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  return parent.node_ops.mknod(parent, name, mode, dev);
 }),
 create: (function(path, mode) {
  mode = mode !== undefined ? mode : 438;
  mode &= 4095;
  mode |= 32768;
  return FS.mknod(path, mode, 0);
 }),
 mkdir: (function(path, mode) {
  mode = mode !== undefined ? mode : 511;
  mode &= 511 | 512;
  mode |= 16384;
  return FS.mknod(path, mode, 0);
 }),
 mkdirTree: (function(path, mode) {
  var dirs = path.split("/");
  var d = "";
  for (var i = 0; i < dirs.length; ++i) {
   if (!dirs[i]) continue;
   d += "/" + dirs[i];
   try {
    FS.mkdir(d, mode);
   } catch (e) {
    if (e.errno != ERRNO_CODES.EEXIST) throw e;
   }
  }
 }),
 mkdev: (function(path, mode, dev) {
  if (typeof dev === "undefined") {
   dev = mode;
   mode = 438;
  }
  mode |= 8192;
  return FS.mknod(path, mode, dev);
 }),
 symlink: (function(oldpath, newpath) {
  if (!PATH.resolve(oldpath)) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  var lookup = FS.lookupPath(newpath, {
   parent: true
  });
  var parent = lookup.node;
  if (!parent) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  var newname = PATH.basename(newpath);
  var err = FS.mayCreate(parent, newname);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  if (!parent.node_ops.symlink) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  return parent.node_ops.symlink(parent, newname, oldpath);
 }),
 rename: (function(old_path, new_path) {
  var old_dirname = PATH.dirname(old_path);
  var new_dirname = PATH.dirname(new_path);
  var old_name = PATH.basename(old_path);
  var new_name = PATH.basename(new_path);
  var lookup, old_dir, new_dir;
  try {
   lookup = FS.lookupPath(old_path, {
    parent: true
   });
   old_dir = lookup.node;
   lookup = FS.lookupPath(new_path, {
    parent: true
   });
   new_dir = lookup.node;
  } catch (e) {
   throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
  }
  if (!old_dir || !new_dir) throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  if (old_dir.mount !== new_dir.mount) {
   throw new FS.ErrnoError(ERRNO_CODES.EXDEV);
  }
  var old_node = FS.lookupNode(old_dir, old_name);
  var relative = PATH.relative(old_path, new_dirname);
  if (relative.charAt(0) !== ".") {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  relative = PATH.relative(new_path, old_dirname);
  if (relative.charAt(0) !== ".") {
   throw new FS.ErrnoError(ERRNO_CODES.ENOTEMPTY);
  }
  var new_node;
  try {
   new_node = FS.lookupNode(new_dir, new_name);
  } catch (e) {}
  if (old_node === new_node) {
   return;
  }
  var isdir = FS.isDir(old_node.mode);
  var err = FS.mayDelete(old_dir, old_name, isdir);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  err = new_node ? FS.mayDelete(new_dir, new_name, isdir) : FS.mayCreate(new_dir, new_name);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  if (!old_dir.node_ops.rename) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  if (FS.isMountpoint(old_node) || new_node && FS.isMountpoint(new_node)) {
   throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
  }
  if (new_dir !== old_dir) {
   err = FS.nodePermissions(old_dir, "w");
   if (err) {
    throw new FS.ErrnoError(err);
   }
  }
  try {
   if (FS.trackingDelegate["willMovePath"]) {
    FS.trackingDelegate["willMovePath"](old_path, new_path);
   }
  } catch (e) {
   console.log("FS.trackingDelegate['willMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
  }
  FS.hashRemoveNode(old_node);
  try {
   old_dir.node_ops.rename(old_node, new_dir, new_name);
  } catch (e) {
   throw e;
  } finally {
   FS.hashAddNode(old_node);
  }
  try {
   if (FS.trackingDelegate["onMovePath"]) FS.trackingDelegate["onMovePath"](old_path, new_path);
  } catch (e) {
   console.log("FS.trackingDelegate['onMovePath']('" + old_path + "', '" + new_path + "') threw an exception: " + e.message);
  }
 }),
 rmdir: (function(path) {
  var lookup = FS.lookupPath(path, {
   parent: true
  });
  var parent = lookup.node;
  var name = PATH.basename(path);
  var node = FS.lookupNode(parent, name);
  var err = FS.mayDelete(parent, name, true);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  if (!parent.node_ops.rmdir) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  if (FS.isMountpoint(node)) {
   throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
  }
  try {
   if (FS.trackingDelegate["willDeletePath"]) {
    FS.trackingDelegate["willDeletePath"](path);
   }
  } catch (e) {
   console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
  }
  parent.node_ops.rmdir(parent, name);
  FS.destroyNode(node);
  try {
   if (FS.trackingDelegate["onDeletePath"]) FS.trackingDelegate["onDeletePath"](path);
  } catch (e) {
   console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
  }
 }),
 readdir: (function(path) {
  var lookup = FS.lookupPath(path, {
   follow: true
  });
  var node = lookup.node;
  if (!node.node_ops.readdir) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
  }
  return node.node_ops.readdir(node);
 }),
 unlink: (function(path) {
  var lookup = FS.lookupPath(path, {
   parent: true
  });
  var parent = lookup.node;
  var name = PATH.basename(path);
  var node = FS.lookupNode(parent, name);
  var err = FS.mayDelete(parent, name, false);
  if (err) {
   throw new FS.ErrnoError(err);
  }
  if (!parent.node_ops.unlink) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  if (FS.isMountpoint(node)) {
   throw new FS.ErrnoError(ERRNO_CODES.EBUSY);
  }
  try {
   if (FS.trackingDelegate["willDeletePath"]) {
    FS.trackingDelegate["willDeletePath"](path);
   }
  } catch (e) {
   console.log("FS.trackingDelegate['willDeletePath']('" + path + "') threw an exception: " + e.message);
  }
  parent.node_ops.unlink(parent, name);
  FS.destroyNode(node);
  try {
   if (FS.trackingDelegate["onDeletePath"]) FS.trackingDelegate["onDeletePath"](path);
  } catch (e) {
   console.log("FS.trackingDelegate['onDeletePath']('" + path + "') threw an exception: " + e.message);
  }
 }),
 readlink: (function(path) {
  var lookup = FS.lookupPath(path);
  var link = lookup.node;
  if (!link) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  if (!link.node_ops.readlink) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  return PATH.resolve(FS.getPath(link.parent), link.node_ops.readlink(link));
 }),
 stat: (function(path, dontFollow) {
  var lookup = FS.lookupPath(path, {
   follow: !dontFollow
  });
  var node = lookup.node;
  if (!node) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  if (!node.node_ops.getattr) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  return node.node_ops.getattr(node);
 }),
 lstat: (function(path) {
  return FS.stat(path, true);
 }),
 chmod: (function(path, mode, dontFollow) {
  var node;
  if (typeof path === "string") {
   var lookup = FS.lookupPath(path, {
    follow: !dontFollow
   });
   node = lookup.node;
  } else {
   node = path;
  }
  if (!node.node_ops.setattr) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  node.node_ops.setattr(node, {
   mode: mode & 4095 | node.mode & ~4095,
   timestamp: Date.now()
  });
 }),
 lchmod: (function(path, mode) {
  FS.chmod(path, mode, true);
 }),
 fchmod: (function(fd, mode) {
  var stream = FS.getStream(fd);
  if (!stream) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  FS.chmod(stream.node, mode);
 }),
 chown: (function(path, uid, gid, dontFollow) {
  var node;
  if (typeof path === "string") {
   var lookup = FS.lookupPath(path, {
    follow: !dontFollow
   });
   node = lookup.node;
  } else {
   node = path;
  }
  if (!node.node_ops.setattr) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  node.node_ops.setattr(node, {
   timestamp: Date.now()
  });
 }),
 lchown: (function(path, uid, gid) {
  FS.chown(path, uid, gid, true);
 }),
 fchown: (function(fd, uid, gid) {
  var stream = FS.getStream(fd);
  if (!stream) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  FS.chown(stream.node, uid, gid);
 }),
 truncate: (function(path, len) {
  if (len < 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var node;
  if (typeof path === "string") {
   var lookup = FS.lookupPath(path, {
    follow: true
   });
   node = lookup.node;
  } else {
   node = path;
  }
  if (!node.node_ops.setattr) {
   throw new FS.ErrnoError(ERRNO_CODES.EPERM);
  }
  if (FS.isDir(node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
  }
  if (!FS.isFile(node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var err = FS.nodePermissions(node, "w");
  if (err) {
   throw new FS.ErrnoError(err);
  }
  node.node_ops.setattr(node, {
   size: len,
   timestamp: Date.now()
  });
 }),
 ftruncate: (function(fd, len) {
  var stream = FS.getStream(fd);
  if (!stream) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  if ((stream.flags & 2097155) === 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  FS.truncate(stream.node, len);
 }),
 utime: (function(path, atime, mtime) {
  var lookup = FS.lookupPath(path, {
   follow: true
  });
  var node = lookup.node;
  node.node_ops.setattr(node, {
   timestamp: Math.max(atime, mtime)
  });
 }),
 open: (function(path, flags, mode, fd_start, fd_end) {
  if (path === "") {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  flags = typeof flags === "string" ? FS.modeStringToFlags(flags) : flags;
  mode = typeof mode === "undefined" ? 438 : mode;
  if (flags & 64) {
   mode = mode & 4095 | 32768;
  } else {
   mode = 0;
  }
  var node;
  if (typeof path === "object") {
   node = path;
  } else {
   path = PATH.normalize(path);
   try {
    var lookup = FS.lookupPath(path, {
     follow: !(flags & 131072)
    });
    node = lookup.node;
   } catch (e) {}
  }
  var created = false;
  if (flags & 64) {
   if (node) {
    if (flags & 128) {
     throw new FS.ErrnoError(ERRNO_CODES.EEXIST);
    }
   } else {
    node = FS.mknod(path, mode, 0);
    created = true;
   }
  }
  if (!node) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  if (FS.isChrdev(node.mode)) {
   flags &= ~512;
  }
  if (flags & 65536 && !FS.isDir(node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
  }
  if (!created) {
   var err = FS.mayOpen(node, flags);
   if (err) {
    throw new FS.ErrnoError(err);
   }
  }
  if (flags & 512) {
   FS.truncate(node, 0);
  }
  flags &= ~(128 | 512);
  var stream = FS.createStream({
   node: node,
   path: FS.getPath(node),
   flags: flags,
   seekable: true,
   position: 0,
   stream_ops: node.stream_ops,
   ungotten: [],
   error: false
  }, fd_start, fd_end);
  if (stream.stream_ops.open) {
   stream.stream_ops.open(stream);
  }
  if (Module["logReadFiles"] && !(flags & 1)) {
   if (!FS.readFiles) FS.readFiles = {};
   if (!(path in FS.readFiles)) {
    FS.readFiles[path] = 1;
    Module["printErr"]("read file: " + path);
   }
  }
  try {
   if (FS.trackingDelegate["onOpenFile"]) {
    var trackingFlags = 0;
    if ((flags & 2097155) !== 1) {
     trackingFlags |= FS.tracking.openFlags.READ;
    }
    if ((flags & 2097155) !== 0) {
     trackingFlags |= FS.tracking.openFlags.WRITE;
    }
    FS.trackingDelegate["onOpenFile"](path, trackingFlags);
   }
  } catch (e) {
   console.log("FS.trackingDelegate['onOpenFile']('" + path + "', flags) threw an exception: " + e.message);
  }
  return stream;
 }),
 close: (function(stream) {
  if (stream.getdents) stream.getdents = null;
  try {
   if (stream.stream_ops.close) {
    stream.stream_ops.close(stream);
   }
  } catch (e) {
   throw e;
  } finally {
   FS.closeStream(stream.fd);
  }
 }),
 llseek: (function(stream, offset, whence) {
  if (!stream.seekable || !stream.stream_ops.llseek) {
   throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
  }
  stream.position = stream.stream_ops.llseek(stream, offset, whence);
  stream.ungotten = [];
  return stream.position;
 }),
 read: (function(stream, buffer, offset, length, position) {
  if (length < 0 || position < 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  if ((stream.flags & 2097155) === 1) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  if (FS.isDir(stream.node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
  }
  if (!stream.stream_ops.read) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  var seeking = true;
  if (typeof position === "undefined") {
   position = stream.position;
   seeking = false;
  } else if (!stream.seekable) {
   throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
  }
  var bytesRead = stream.stream_ops.read(stream, buffer, offset, length, position);
  if (!seeking) stream.position += bytesRead;
  return bytesRead;
 }),
 write: (function(stream, buffer, offset, length, position, canOwn) {
  if (length < 0 || position < 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  if ((stream.flags & 2097155) === 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  if (FS.isDir(stream.node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.EISDIR);
  }
  if (!stream.stream_ops.write) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  if (stream.flags & 1024) {
   FS.llseek(stream, 0, 2);
  }
  var seeking = true;
  if (typeof position === "undefined") {
   position = stream.position;
   seeking = false;
  } else if (!stream.seekable) {
   throw new FS.ErrnoError(ERRNO_CODES.ESPIPE);
  }
  var bytesWritten = stream.stream_ops.write(stream, buffer, offset, length, position, canOwn);
  if (!seeking) stream.position += bytesWritten;
  try {
   if (stream.path && FS.trackingDelegate["onWriteToFile"]) FS.trackingDelegate["onWriteToFile"](stream.path);
  } catch (e) {
   console.log("FS.trackingDelegate['onWriteToFile']('" + path + "') threw an exception: " + e.message);
  }
  return bytesWritten;
 }),
 allocate: (function(stream, offset, length) {
  if (offset < 0 || length <= 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
  }
  if ((stream.flags & 2097155) === 0) {
   throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  }
  if (!FS.isFile(stream.node.mode) && !FS.isDir(node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
  }
  if (!stream.stream_ops.allocate) {
   throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
  }
  stream.stream_ops.allocate(stream, offset, length);
 }),
 mmap: (function(stream, buffer, offset, length, position, prot, flags) {
  if ((stream.flags & 2097155) === 1) {
   throw new FS.ErrnoError(ERRNO_CODES.EACCES);
  }
  if (!stream.stream_ops.mmap) {
   throw new FS.ErrnoError(ERRNO_CODES.ENODEV);
  }
  return stream.stream_ops.mmap(stream, buffer, offset, length, position, prot, flags);
 }),
 msync: (function(stream, buffer, offset, length, mmapFlags) {
  if (!stream || !stream.stream_ops.msync) {
   return 0;
  }
  return stream.stream_ops.msync(stream, buffer, offset, length, mmapFlags);
 }),
 munmap: (function(stream) {
  return 0;
 }),
 ioctl: (function(stream, cmd, arg) {
  if (!stream.stream_ops.ioctl) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOTTY);
  }
  return stream.stream_ops.ioctl(stream, cmd, arg);
 }),
 readFile: (function(path, opts) {
  opts = opts || {};
  opts.flags = opts.flags || "r";
  opts.encoding = opts.encoding || "binary";
  if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
   throw new Error('Invalid encoding type "' + opts.encoding + '"');
  }
  var ret;
  var stream = FS.open(path, opts.flags);
  var stat = FS.stat(path);
  var length = stat.size;
  var buf = new Uint8Array(length);
  FS.read(stream, buf, 0, length, 0);
  if (opts.encoding === "utf8") {
   ret = UTF8ArrayToString(buf, 0);
  } else if (opts.encoding === "binary") {
   ret = buf;
  }
  FS.close(stream);
  return ret;
 }),
 writeFile: (function(path, data, opts) {
  opts = opts || {};
  opts.flags = opts.flags || "w";
  opts.encoding = opts.encoding || "utf8";
  if (opts.encoding !== "utf8" && opts.encoding !== "binary") {
   throw new Error('Invalid encoding type "' + opts.encoding + '"');
  }
  var stream = FS.open(path, opts.flags, opts.mode);
  if (opts.encoding === "utf8") {
   var buf = new Uint8Array(lengthBytesUTF8(data) + 1);
   var actualNumBytes = stringToUTF8Array(data, buf, 0, buf.length);
   FS.write(stream, buf, 0, actualNumBytes, 0, opts.canOwn);
  } else if (opts.encoding === "binary") {
   FS.write(stream, data, 0, data.length, 0, opts.canOwn);
  }
  FS.close(stream);
 }),
 cwd: (function() {
  return FS.currentPath;
 }),
 chdir: (function(path) {
  var lookup = FS.lookupPath(path, {
   follow: true
  });
  if (lookup.node === null) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOENT);
  }
  if (!FS.isDir(lookup.node.mode)) {
   throw new FS.ErrnoError(ERRNO_CODES.ENOTDIR);
  }
  var err = FS.nodePermissions(lookup.node, "x");
  if (err) {
   throw new FS.ErrnoError(err);
  }
  FS.currentPath = lookup.path;
 }),
 createDefaultDirectories: (function() {
  FS.mkdir("/tmp");
  FS.mkdir("/home");
  FS.mkdir("/home/web_user");
 }),
 createDefaultDevices: (function() {
  FS.mkdir("/dev");
  FS.registerDevice(FS.makedev(1, 3), {
   read: (function() {
    return 0;
   }),
   write: (function(stream, buffer, offset, length, pos) {
    return length;
   })
  });
  FS.mkdev("/dev/null", FS.makedev(1, 3));
  TTY.register(FS.makedev(5, 0), TTY.default_tty_ops);
  TTY.register(FS.makedev(6, 0), TTY.default_tty1_ops);
  FS.mkdev("/dev/tty", FS.makedev(5, 0));
  FS.mkdev("/dev/tty1", FS.makedev(6, 0));
  var random_device;
  if (typeof crypto !== "undefined") {
   var randomBuffer = new Uint8Array(1);
   random_device = (function() {
    crypto.getRandomValues(randomBuffer);
    return randomBuffer[0];
   });
  } else if (ENVIRONMENT_IS_NODE) {
   random_device = (function() {
    return require("crypto").randomBytes(1)[0];
   });
  } else {
   random_device = (function() {
    return Math.random() * 256 | 0;
   });
  }
  FS.createDevice("/dev", "random", random_device);
  FS.createDevice("/dev", "urandom", random_device);
  FS.mkdir("/dev/shm");
  FS.mkdir("/dev/shm/tmp");
 }),
 createSpecialDirectories: (function() {
  FS.mkdir("/proc");
  FS.mkdir("/proc/self");
  FS.mkdir("/proc/self/fd");
  FS.mount({
   mount: (function() {
    var node = FS.createNode("/proc/self", "fd", 16384 | 511, 73);
    node.node_ops = {
     lookup: (function(parent, name) {
      var fd = +name;
      var stream = FS.getStream(fd);
      if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
      var ret = {
       parent: null,
       mount: {
        mountpoint: "fake"
       },
       node_ops: {
        readlink: (function() {
         return stream.path;
        })
       }
      };
      ret.parent = ret;
      return ret;
     })
    };
    return node;
   })
  }, {}, "/proc/self/fd");
 }),
 createStandardStreams: (function() {
  if (Module["stdin"]) {
   FS.createDevice("/dev", "stdin", Module["stdin"]);
  } else {
   FS.symlink("/dev/tty", "/dev/stdin");
  }
  if (Module["stdout"]) {
   FS.createDevice("/dev", "stdout", null, Module["stdout"]);
  } else {
   FS.symlink("/dev/tty", "/dev/stdout");
  }
  if (Module["stderr"]) {
   FS.createDevice("/dev", "stderr", null, Module["stderr"]);
  } else {
   FS.symlink("/dev/tty1", "/dev/stderr");
  }
  var stdin = FS.open("/dev/stdin", "r");
  assert(stdin.fd === 0, "invalid handle for stdin (" + stdin.fd + ")");
  var stdout = FS.open("/dev/stdout", "w");
  assert(stdout.fd === 1, "invalid handle for stdout (" + stdout.fd + ")");
  var stderr = FS.open("/dev/stderr", "w");
  assert(stderr.fd === 2, "invalid handle for stderr (" + stderr.fd + ")");
 }),
 ensureErrnoError: (function() {
  if (FS.ErrnoError) return;
  FS.ErrnoError = function ErrnoError(errno, node) {
   this.node = node;
   this.setErrno = (function(errno) {
    this.errno = errno;
    for (var key in ERRNO_CODES) {
     if (ERRNO_CODES[key] === errno) {
      this.code = key;
      break;
     }
    }
   });
   this.setErrno(errno);
   this.message = ERRNO_MESSAGES[errno];
   if (this.stack) this.stack = demangleAll(this.stack);
  };
  FS.ErrnoError.prototype = new Error;
  FS.ErrnoError.prototype.constructor = FS.ErrnoError;
  [ ERRNO_CODES.ENOENT ].forEach((function(code) {
   FS.genericErrors[code] = new FS.ErrnoError(code);
   FS.genericErrors[code].stack = "<generic error, no stack>";
  }));
 }),
 staticInit: (function() {
  FS.ensureErrnoError();
  FS.nameTable = new Array(4096);
  FS.mount(MEMFS, {}, "/");
  FS.createDefaultDirectories();
  FS.createDefaultDevices();
  FS.createSpecialDirectories();
  FS.filesystems = {
   "MEMFS": MEMFS,
   "IDBFS": IDBFS,
   "NODEFS": NODEFS,
   "WORKERFS": WORKERFS
  };
 }),
 init: (function(input, output, error) {
  assert(!FS.init.initialized, "FS.init was previously called. If you want to initialize later with custom parameters, remove any earlier calls (note that one is automatically added to the generated code)");
  FS.init.initialized = true;
  FS.ensureErrnoError();
  Module["stdin"] = input || Module["stdin"];
  Module["stdout"] = output || Module["stdout"];
  Module["stderr"] = error || Module["stderr"];
  FS.createStandardStreams();
 }),
 quit: (function() {
  FS.init.initialized = false;
  var fflush = Module["_fflush"];
  if (fflush) fflush(0);
  for (var i = 0; i < FS.streams.length; i++) {
   var stream = FS.streams[i];
   if (!stream) {
    continue;
   }
   FS.close(stream);
  }
 }),
 getMode: (function(canRead, canWrite) {
  var mode = 0;
  if (canRead) mode |= 292 | 73;
  if (canWrite) mode |= 146;
  return mode;
 }),
 joinPath: (function(parts, forceRelative) {
  var path = PATH.join.apply(null, parts);
  if (forceRelative && path[0] == "/") path = path.substr(1);
  return path;
 }),
 absolutePath: (function(relative, base) {
  return PATH.resolve(base, relative);
 }),
 standardizePath: (function(path) {
  return PATH.normalize(path);
 }),
 findObject: (function(path, dontResolveLastLink) {
  var ret = FS.analyzePath(path, dontResolveLastLink);
  if (ret.exists) {
   return ret.object;
  } else {
   ___setErrNo(ret.error);
   return null;
  }
 }),
 analyzePath: (function(path, dontResolveLastLink) {
  try {
   var lookup = FS.lookupPath(path, {
    follow: !dontResolveLastLink
   });
   path = lookup.path;
  } catch (e) {}
  var ret = {
   isRoot: false,
   exists: false,
   error: 0,
   name: null,
   path: null,
   object: null,
   parentExists: false,
   parentPath: null,
   parentObject: null
  };
  try {
   var lookup = FS.lookupPath(path, {
    parent: true
   });
   ret.parentExists = true;
   ret.parentPath = lookup.path;
   ret.parentObject = lookup.node;
   ret.name = PATH.basename(path);
   lookup = FS.lookupPath(path, {
    follow: !dontResolveLastLink
   });
   ret.exists = true;
   ret.path = lookup.path;
   ret.object = lookup.node;
   ret.name = lookup.node.name;
   ret.isRoot = lookup.path === "/";
  } catch (e) {
   ret.error = e.errno;
  }
  return ret;
 }),
 createFolder: (function(parent, name, canRead, canWrite) {
  var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
  var mode = FS.getMode(canRead, canWrite);
  return FS.mkdir(path, mode);
 }),
 createPath: (function(parent, path, canRead, canWrite) {
  parent = typeof parent === "string" ? parent : FS.getPath(parent);
  var parts = path.split("/").reverse();
  while (parts.length) {
   var part = parts.pop();
   if (!part) continue;
   var current = PATH.join2(parent, part);
   try {
    FS.mkdir(current);
   } catch (e) {}
   parent = current;
  }
  return current;
 }),
 createFile: (function(parent, name, properties, canRead, canWrite) {
  var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
  var mode = FS.getMode(canRead, canWrite);
  return FS.create(path, mode);
 }),
 createDataFile: (function(parent, name, data, canRead, canWrite, canOwn) {
  var path = name ? PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name) : parent;
  var mode = FS.getMode(canRead, canWrite);
  var node = FS.create(path, mode);
  if (data) {
   if (typeof data === "string") {
    var arr = new Array(data.length);
    for (var i = 0, len = data.length; i < len; ++i) arr[i] = data.charCodeAt(i);
    data = arr;
   }
   FS.chmod(node, mode | 146);
   var stream = FS.open(node, "w");
   FS.write(stream, data, 0, data.length, 0, canOwn);
   FS.close(stream);
   FS.chmod(node, mode);
  }
  return node;
 }),
 createDevice: (function(parent, name, input, output) {
  var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
  var mode = FS.getMode(!!input, !!output);
  if (!FS.createDevice.major) FS.createDevice.major = 64;
  var dev = FS.makedev(FS.createDevice.major++, 0);
  FS.registerDevice(dev, {
   open: (function(stream) {
    stream.seekable = false;
   }),
   close: (function(stream) {
    if (output && output.buffer && output.buffer.length) {
     output(10);
    }
   }),
   read: (function(stream, buffer, offset, length, pos) {
    var bytesRead = 0;
    for (var i = 0; i < length; i++) {
     var result;
     try {
      result = input();
     } catch (e) {
      throw new FS.ErrnoError(ERRNO_CODES.EIO);
     }
     if (result === undefined && bytesRead === 0) {
      throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
     }
     if (result === null || result === undefined) break;
     bytesRead++;
     buffer[offset + i] = result;
    }
    if (bytesRead) {
     stream.node.timestamp = Date.now();
    }
    return bytesRead;
   }),
   write: (function(stream, buffer, offset, length, pos) {
    for (var i = 0; i < length; i++) {
     try {
      output(buffer[offset + i]);
     } catch (e) {
      throw new FS.ErrnoError(ERRNO_CODES.EIO);
     }
    }
    if (length) {
     stream.node.timestamp = Date.now();
    }
    return i;
   })
  });
  return FS.mkdev(path, mode, dev);
 }),
 createLink: (function(parent, name, target, canRead, canWrite) {
  var path = PATH.join2(typeof parent === "string" ? parent : FS.getPath(parent), name);
  return FS.symlink(target, path);
 }),
 forceLoadFile: (function(obj) {
  if (obj.isDevice || obj.isFolder || obj.link || obj.contents) return true;
  var success = true;
  if (typeof XMLHttpRequest !== "undefined") {
   throw new Error("Lazy loading should have been performed (contents set) in createLazyFile, but it was not. Lazy loading only works in web workers. Use --embed-file or --preload-file in emcc on the main thread.");
  } else if (Module["read"]) {
   try {
    obj.contents = intArrayFromString(Module["read"](obj.url), true);
    obj.usedBytes = obj.contents.length;
   } catch (e) {
    success = false;
   }
  } else {
   throw new Error("Cannot load without read() or XMLHttpRequest.");
  }
  if (!success) ___setErrNo(ERRNO_CODES.EIO);
  return success;
 }),
 createLazyFile: (function(parent, name, url, canRead, canWrite) {
  function LazyUint8Array() {
   this.lengthKnown = false;
   this.chunks = [];
  }
  LazyUint8Array.prototype.get = function LazyUint8Array_get(idx) {
   if (idx > this.length - 1 || idx < 0) {
    return undefined;
   }
   var chunkOffset = idx % this.chunkSize;
   var chunkNum = idx / this.chunkSize | 0;
   return this.getter(chunkNum)[chunkOffset];
  };
  LazyUint8Array.prototype.setDataGetter = function LazyUint8Array_setDataGetter(getter) {
   this.getter = getter;
  };
  LazyUint8Array.prototype.cacheLength = function LazyUint8Array_cacheLength() {
   var xhr = new XMLHttpRequest;
   xhr.open("HEAD", url, false);
   xhr.send(null);
   if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
   var datalength = Number(xhr.getResponseHeader("Content-length"));
   var header;
   var hasByteServing = (header = xhr.getResponseHeader("Accept-Ranges")) && header === "bytes";
   var usesGzip = (header = xhr.getResponseHeader("Content-Encoding")) && header === "gzip";
   var chunkSize = 1024 * 1024;
   if (!hasByteServing) chunkSize = datalength;
   var doXHR = (function(from, to) {
    if (from > to) throw new Error("invalid range (" + from + ", " + to + ") or no bytes requested!");
    if (to > datalength - 1) throw new Error("only " + datalength + " bytes available! programmer error!");
    var xhr = new XMLHttpRequest;
    xhr.open("GET", url, false);
    if (datalength !== chunkSize) xhr.setRequestHeader("Range", "bytes=" + from + "-" + to);
    if (typeof Uint8Array != "undefined") xhr.responseType = "arraybuffer";
    if (xhr.overrideMimeType) {
     xhr.overrideMimeType("text/plain; charset=x-user-defined");
    }
    xhr.send(null);
    if (!(xhr.status >= 200 && xhr.status < 300 || xhr.status === 304)) throw new Error("Couldn't load " + url + ". Status: " + xhr.status);
    if (xhr.response !== undefined) {
     return new Uint8Array(xhr.response || []);
    } else {
     return intArrayFromString(xhr.responseText || "", true);
    }
   });
   var lazyArray = this;
   lazyArray.setDataGetter((function(chunkNum) {
    var start = chunkNum * chunkSize;
    var end = (chunkNum + 1) * chunkSize - 1;
    end = Math.min(end, datalength - 1);
    if (typeof lazyArray.chunks[chunkNum] === "undefined") {
     lazyArray.chunks[chunkNum] = doXHR(start, end);
    }
    if (typeof lazyArray.chunks[chunkNum] === "undefined") throw new Error("doXHR failed!");
    return lazyArray.chunks[chunkNum];
   }));
   if (usesGzip || !datalength) {
    chunkSize = datalength = 1;
    datalength = this.getter(0).length;
    chunkSize = datalength;
    console.log("LazyFiles on gzip forces download of the whole file when length is accessed");
   }
   this._length = datalength;
   this._chunkSize = chunkSize;
   this.lengthKnown = true;
  };
  if (typeof XMLHttpRequest !== "undefined") {
   if (!ENVIRONMENT_IS_WORKER) throw "Cannot do synchronous binary XHRs outside webworkers in modern browsers. Use --embed-file or --preload-file in emcc";
   var lazyArray = new LazyUint8Array;
   Object.defineProperties(lazyArray, {
    length: {
     get: (function() {
      if (!this.lengthKnown) {
       this.cacheLength();
      }
      return this._length;
     })
    },
    chunkSize: {
     get: (function() {
      if (!this.lengthKnown) {
       this.cacheLength();
      }
      return this._chunkSize;
     })
    }
   });
   var properties = {
    isDevice: false,
    contents: lazyArray
   };
  } else {
   var properties = {
    isDevice: false,
    url: url
   };
  }
  var node = FS.createFile(parent, name, properties, canRead, canWrite);
  if (properties.contents) {
   node.contents = properties.contents;
  } else if (properties.url) {
   node.contents = null;
   node.url = properties.url;
  }
  Object.defineProperties(node, {
   usedBytes: {
    get: (function() {
     return this.contents.length;
    })
   }
  });
  var stream_ops = {};
  var keys = Object.keys(node.stream_ops);
  keys.forEach((function(key) {
   var fn = node.stream_ops[key];
   stream_ops[key] = function forceLoadLazyFile() {
    if (!FS.forceLoadFile(node)) {
     throw new FS.ErrnoError(ERRNO_CODES.EIO);
    }
    return fn.apply(null, arguments);
   };
  }));
  stream_ops.read = function stream_ops_read(stream, buffer, offset, length, position) {
   if (!FS.forceLoadFile(node)) {
    throw new FS.ErrnoError(ERRNO_CODES.EIO);
   }
   var contents = stream.node.contents;
   if (position >= contents.length) return 0;
   var size = Math.min(contents.length - position, length);
   assert(size >= 0);
   if (contents.slice) {
    for (var i = 0; i < size; i++) {
     buffer[offset + i] = contents[position + i];
    }
   } else {
    for (var i = 0; i < size; i++) {
     buffer[offset + i] = contents.get(position + i);
    }
   }
   return size;
  };
  node.stream_ops = stream_ops;
  return node;
 }),
 createPreloadedFile: (function(parent, name, url, canRead, canWrite, onload, onerror, dontCreateFile, canOwn, preFinish) {
  Browser.init();
  var fullname = name ? PATH.resolve(PATH.join2(parent, name)) : parent;
  var dep = getUniqueRunDependency("cp " + fullname);
  function processData(byteArray) {
   function finish(byteArray) {
    if (preFinish) preFinish();
    if (!dontCreateFile) {
     FS.createDataFile(parent, name, byteArray, canRead, canWrite, canOwn);
    }
    if (onload) onload();
    removeRunDependency(dep);
   }
   var handled = false;
   Module["preloadPlugins"].forEach((function(plugin) {
    if (handled) return;
    if (plugin["canHandle"](fullname)) {
     plugin["handle"](byteArray, fullname, finish, (function() {
      if (onerror) onerror();
      removeRunDependency(dep);
     }));
     handled = true;
    }
   }));
   if (!handled) finish(byteArray);
  }
  addRunDependency(dep);
  if (typeof url == "string") {
   Browser.asyncLoad(url, (function(byteArray) {
    processData(byteArray);
   }), onerror);
  } else {
   processData(url);
  }
 }),
 indexedDB: (function() {
  return Module.indexedDB;
 }),
 DB_NAME: (function() {
  return "EM_FS_" + window.location.pathname;
 }),
 DB_VERSION: 20,
 DB_STORE_NAME: "FILE_DATA",
 saveFilesToDB: (function(paths, onload, onerror) {
  onload = onload || (function() {});
  onerror = onerror || (function() {});
  var indexedDB = FS.indexedDB();
  try {
   var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
  } catch (e) {
   return onerror(e);
  }
  openRequest.onupgradeneeded = function openRequest_onupgradeneeded() {
   console.log("creating db");
   var db = openRequest.result;
   db.createObjectStore(FS.DB_STORE_NAME);
  };
  openRequest.onsuccess = function openRequest_onsuccess() {
   var db = openRequest.result;
   var transaction = db.transaction([ FS.DB_STORE_NAME ], "readwrite");
   var files = transaction.objectStore(FS.DB_STORE_NAME);
   var ok = 0, fail = 0, total = paths.length;
   function finish() {
    if (fail == 0) onload(); else onerror();
   }
   paths.forEach((function(path) {
    var putRequest = files.put(FS.analyzePath(path).object.contents, path);
    putRequest.onsuccess = function putRequest_onsuccess() {
     ok++;
     if (ok + fail == total) finish();
    };
    putRequest.onerror = function putRequest_onerror() {
     fail++;
     if (ok + fail == total) finish();
    };
   }));
   transaction.onerror = onerror;
  };
  openRequest.onerror = onerror;
 }),
 loadFilesFromDB: (function(paths, onload, onerror) {
  onload = onload || (function() {});
  onerror = onerror || (function() {});
  var indexedDB = FS.indexedDB();
  try {
   var openRequest = indexedDB.open(FS.DB_NAME(), FS.DB_VERSION);
  } catch (e) {
   return onerror(e);
  }
  openRequest.onupgradeneeded = onerror;
  openRequest.onsuccess = function openRequest_onsuccess() {
   var db = openRequest.result;
   try {
    var transaction = db.transaction([ FS.DB_STORE_NAME ], "readonly");
   } catch (e) {
    onerror(e);
    return;
   }
   var files = transaction.objectStore(FS.DB_STORE_NAME);
   var ok = 0, fail = 0, total = paths.length;
   function finish() {
    if (fail == 0) onload(); else onerror();
   }
   paths.forEach((function(path) {
    var getRequest = files.get(path);
    getRequest.onsuccess = function getRequest_onsuccess() {
     if (FS.analyzePath(path).exists) {
      FS.unlink(path);
     }
     FS.createDataFile(PATH.dirname(path), PATH.basename(path), getRequest.result, true, true, true);
     ok++;
     if (ok + fail == total) finish();
    };
    getRequest.onerror = function getRequest_onerror() {
     fail++;
     if (ok + fail == total) finish();
    };
   }));
   transaction.onerror = onerror;
  };
  openRequest.onerror = onerror;
 })
};
function _utime(path, times) {
 var time;
 if (times) {
  var offset = 4;
  time = HEAP32[times + offset >> 2];
  time *= 1e3;
 } else {
  time = Date.now();
 }
 path = Pointer_stringify(path);
 try {
  FS.utime(path, time, time);
  return 0;
 } catch (e) {
  FS.handleFSError(e);
  return -1;
 }
}
function _emscripten_glCopyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
 GLctx["copyTexImage2D"](x0, x1, x2, x3, x4, x5, x6, x7);
}
function _emscripten_set_devicemotion_callback(userData, useCapture, callbackfunc) {
 JSEvents.registerDeviceMotionEventCallback(window, userData, useCapture, callbackfunc, 17, "devicemotion");
 return 0;
}
function _JS_SystemInfo_HasFullscreen() {
 return UnityLoader.SystemInfo.hasFullscreen;
}
function _emscripten_glTexParameterfv(target, pname, params) {
 var param = HEAPF32[params >> 2];
 GLctx.texParameterf(target, pname, param);
}
function _emscripten_glDepthRangef(x0, x1) {
 GLctx["depthRange"](x0, x1);
}
var SYSCALLS = {
 DEFAULT_POLLMASK: 5,
 mappings: {},
 umask: 511,
 calculateAt: (function(dirfd, path) {
  if (path[0] !== "/") {
   var dir;
   if (dirfd === -100) {
    dir = FS.cwd();
   } else {
    var dirstream = FS.getStream(dirfd);
    if (!dirstream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
    dir = dirstream.path;
   }
   path = PATH.join2(dir, path);
  }
  return path;
 }),
 doStat: (function(func, path, buf) {
  try {
   var stat = func(path);
  } catch (e) {
   if (e && e.node && PATH.normalize(path) !== PATH.normalize(FS.getPath(e.node))) {
    return -ERRNO_CODES.ENOTDIR;
   }
   throw e;
  }
  HEAP32[buf >> 2] = stat.dev;
  HEAP32[buf + 4 >> 2] = 0;
  HEAP32[buf + 8 >> 2] = stat.ino;
  HEAP32[buf + 12 >> 2] = stat.mode;
  HEAP32[buf + 16 >> 2] = stat.nlink;
  HEAP32[buf + 20 >> 2] = stat.uid;
  HEAP32[buf + 24 >> 2] = stat.gid;
  HEAP32[buf + 28 >> 2] = stat.rdev;
  HEAP32[buf + 32 >> 2] = 0;
  HEAP32[buf + 36 >> 2] = stat.size;
  HEAP32[buf + 40 >> 2] = 4096;
  HEAP32[buf + 44 >> 2] = stat.blocks;
  HEAP32[buf + 48 >> 2] = stat.atime.getTime() / 1e3 | 0;
  HEAP32[buf + 52 >> 2] = 0;
  HEAP32[buf + 56 >> 2] = stat.mtime.getTime() / 1e3 | 0;
  HEAP32[buf + 60 >> 2] = 0;
  HEAP32[buf + 64 >> 2] = stat.ctime.getTime() / 1e3 | 0;
  HEAP32[buf + 68 >> 2] = 0;
  HEAP32[buf + 72 >> 2] = stat.ino;
  return 0;
 }),
 doMsync: (function(addr, stream, len, flags) {
  var buffer = new Uint8Array(HEAPU8.subarray(addr, addr + len));
  FS.msync(stream, buffer, 0, len, flags);
 }),
 doMkdir: (function(path, mode) {
  path = PATH.normalize(path);
  if (path[path.length - 1] === "/") path = path.substr(0, path.length - 1);
  FS.mkdir(path, mode, 0);
  return 0;
 }),
 doMknod: (function(path, mode, dev) {
  switch (mode & 61440) {
  case 32768:
  case 8192:
  case 24576:
  case 4096:
  case 49152:
   break;
  default:
   return -ERRNO_CODES.EINVAL;
  }
  FS.mknod(path, mode, dev);
  return 0;
 }),
 doReadlink: (function(path, buf, bufsize) {
  if (bufsize <= 0) return -ERRNO_CODES.EINVAL;
  var ret = FS.readlink(path);
  var len = Math.min(bufsize, lengthBytesUTF8(ret));
  var endChar = HEAP8[buf + len];
  stringToUTF8(ret, buf, bufsize + 1);
  HEAP8[buf + len] = endChar;
  return len;
 }),
 doAccess: (function(path, amode) {
  if (amode & ~7) {
   return -ERRNO_CODES.EINVAL;
  }
  var node;
  var lookup = FS.lookupPath(path, {
   follow: true
  });
  node = lookup.node;
  var perms = "";
  if (amode & 4) perms += "r";
  if (amode & 2) perms += "w";
  if (amode & 1) perms += "x";
  if (perms && FS.nodePermissions(node, perms)) {
   return -ERRNO_CODES.EACCES;
  }
  return 0;
 }),
 doDup: (function(path, flags, suggestFD) {
  var suggest = FS.getStream(suggestFD);
  if (suggest) FS.close(suggest);
  return FS.open(path, flags, 0, suggestFD, suggestFD).fd;
 }),
 doReadv: (function(stream, iov, iovcnt, offset) {
  var ret = 0;
  for (var i = 0; i < iovcnt; i++) {
   var ptr = HEAP32[iov + i * 8 >> 2];
   var len = HEAP32[iov + (i * 8 + 4) >> 2];
   var curr = FS.read(stream, HEAP8, ptr, len, offset);
   if (curr < 0) return -1;
   ret += curr;
   if (curr < len) break;
  }
  return ret;
 }),
 doWritev: (function(stream, iov, iovcnt, offset) {
  var ret = 0;
  for (var i = 0; i < iovcnt; i++) {
   var ptr = HEAP32[iov + i * 8 >> 2];
   var len = HEAP32[iov + (i * 8 + 4) >> 2];
   var curr = FS.write(stream, HEAP8, ptr, len, offset);
   if (curr < 0) return -1;
   ret += curr;
  }
  return ret;
 }),
 varargs: 0,
 get: (function(varargs) {
  SYSCALLS.varargs += 4;
  var ret = HEAP32[SYSCALLS.varargs - 4 >> 2];
  return ret;
 }),
 getStr: (function() {
  var ret = Pointer_stringify(SYSCALLS.get());
  return ret;
 }),
 getStreamFromFD: (function() {
  var stream = FS.getStream(SYSCALLS.get());
  if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  return stream;
 }),
 getSocketFromFD: (function() {
  var socket = SOCKFS.getSocket(SYSCALLS.get());
  if (!socket) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
  return socket;
 }),
 getSocketAddress: (function(allowNull) {
  var addrp = SYSCALLS.get(), addrlen = SYSCALLS.get();
  if (allowNull && addrp === 0) return null;
  var info = __read_sockaddr(addrp, addrlen);
  if (info.errno) throw new FS.ErrnoError(info.errno);
  info.addr = DNS.lookup_addr(info.addr) || info.addr;
  return info;
 }),
 get64: (function() {
  var low = SYSCALLS.get(), high = SYSCALLS.get();
  if (low >= 0) assert(high === 0); else assert(high === -1);
  return low;
 }),
 getZero: (function() {
  assert(SYSCALLS.get() === 0);
 })
};
function ___syscall168(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var fds = SYSCALLS.get(), nfds = SYSCALLS.get(), timeout = SYSCALLS.get();
  var nonzero = 0;
  for (var i = 0; i < nfds; i++) {
   var pollfd = fds + 8 * i;
   var fd = HEAP32[pollfd >> 2];
   var events = HEAP16[pollfd + 4 >> 1];
   var mask = 32;
   var stream = FS.getStream(fd);
   if (stream) {
    mask = SYSCALLS.DEFAULT_POLLMASK;
    if (stream.stream_ops.poll) {
     mask = stream.stream_ops.poll(stream);
    }
   }
   mask &= events | 8 | 16;
   if (mask) nonzero++;
   HEAP16[pollfd + 6 >> 1] = mask;
  }
  return nonzero;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _JS_UNETWebSockets_HostsContainingMessagesCleanHost(hostId) {
 for (i = 0; i < UNETWebSocketsInstances.hostsContainingMessages.length; i++) {
  if (UNETWebSocketsInstances.hostsContainingMessages[i].id == hostId) UNETWebSocketsInstances.hostsContainingMessages[i] = null;
 }
 var socket = UNETWebSocketsInstances.hostsContainingMessages[0];
 if (socket == null) return;
 if (socket.messages.length == 0) {
  socket.inQueue = false;
 } else {
  UNETWebSocketsInstances.hostsContainingMessages.push(socket);
 }
 UNETWebSocketsInstances.hostsContainingMessages.shift();
}
function _JS_UNETWebSockets_HostsContainingMessagesPush(socket) {
 if (socket.inQueue == false) {
  UNETWebSocketsInstances.hostsContainingMessages.push(socket);
  socket.inQueue = true;
 }
}
var UNETWebSocketsInstances = {
 hosts: [ undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined ],
 hostsContainingMessages: [],
 pingDataArray: null,
 HostStates: {
  Created: 0,
  Opening: 1,
  Connected: 2,
  Closing: 3,
  Closed: 4
 },
 EventTypes: {
  DataEvent: 0,
  ConnectEvent: 1,
  DisconnectEvent: 2,
  Nothing: 3
 }
};
function _JS_UNETWebSockets_IsHostReadyToConnect(i) {
 if (i < UNETWebSocketsInstances.hosts.length && UNETWebSocketsInstances.hosts[i] != null && UNETWebSocketsInstances.hosts[i].socket == null) {
  return true;
 }
 return false;
}
function _JS_SystemInfo_GetBrowserName(buffer, bufferSize) {
 var browser = UnityLoader.SystemInfo.browser;
 if (buffer) stringToUTF8(browser, buffer, bufferSize);
 return lengthBytesUTF8(browser);
}
function _emscripten_glGetObjectParameterivARB() {
 Module["printErr"]("missing function: emscripten_glGetObjectParameterivARB");
 abort(-1);
}
function _glCreateShader(shaderType) {
 var id = GL.getNewId(GL.shaders);
 GL.shaders[id] = GLctx.createShader(shaderType);
 return id;
}
function _emscripten_glBindAttribLocation(program, index, name) {
 name = Pointer_stringify(name);
 GLctx.bindAttribLocation(GL.programs[program], index, name);
}
function _glInvalidateFramebuffer(target, numAttachments, attachments) {
 var list = [];
 for (var i = 0; i < numAttachments; i++) list.push(HEAP32[attachments + i * 4 >> 2]);
 GLctx["invalidateFramebuffer"](target, list);
}
function _glCopyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
 GLctx["copyTexSubImage2D"](x0, x1, x2, x3, x4, x5, x6, x7);
}
function _glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
 var heapView;
 if (data) {
  heapView = HEAPU8.subarray(data, data + imageSize);
 } else {
  heapView = null;
 }
 GLctx["compressedTexImage2D"](target, level, internalFormat, width, height, border, heapView);
}
function _glBlendFuncSeparate(x0, x1, x2, x3) {
 GLctx["blendFuncSeparate"](x0, x1, x2, x3);
}
Module["_memset"] = _memset;
function _glDrawBuffers(n, bufs) {
 var bufArray = [];
 for (var i = 0; i < n; i++) bufArray.push(HEAP32[bufs + i * 4 >> 2]);
 GLctx["drawBuffers"](bufArray);
}
function _JS_SystemInfo_HasCursorLock() {
 return UnityLoader.SystemInfo.hasCursorLock;
}
function _glBindBufferBase(target, index, buffer) {
 var bufferObj = buffer ? GL.buffers[buffer] : null;
 GLctx["bindBufferBase"](target, index, bufferObj);
}
var wr = {
 requestInstances: {},
 nextRequestId: 1
};
function _JS_WebRequest_Send(request, ptr, length) {
 var http = wr.requestInstances[request];
 try {
  if (length > 0) http.send(HEAPU8.subarray(ptr, ptr + length)); else http.send();
 } catch (e) {
  console.error(e.name + ": " + e.message);
 }
}
function ___lock() {}
function _emscripten_glGetVertexAttribPointerv(index, pname, pointer) {
 if (!pointer) {
  GL.recordError(1281);
  return;
 }
 HEAP32[pointer >> 2] = GLctx.getVertexAttribOffset(index, pname);
}
function _emscripten_glVertexAttrib3f(x0, x1, x2, x3) {
 GLctx["vertexAttrib3f"](x0, x1, x2, x3);
}
function _clock() {
 if (_clock.start === undefined) _clock.start = Date.now();
 return (Date.now() - _clock.start) * (1e6 / 1e3) | 0;
}
function _glGetInternalformativ() {
 Module["printErr"]("missing function: glGetInternalformativ");
 abort(-1);
}
function _glDeleteProgram(id) {
 if (!id) return;
 var program = GL.programs[id];
 if (!program) {
  GL.recordError(1281);
  return;
 }
 GLctx.deleteProgram(program);
 program.name = 0;
 GL.programs[id] = null;
 GL.programInfos[id] = null;
}
function _glRenderbufferStorage(x0, x1, x2, x3) {
 GLctx["renderbufferStorage"](x0, x1, x2, x3);
}
var WEBAudio = {
 audioInstances: [],
 audioContext: {},
 audioWebEnabled: 0
};
function _JS_Sound_SetListenerPosition(x, y, z) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioContext.listener.setPosition(x, y, z);
}
function _pthread_detach() {}
function _emscripten_set_touchstart_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 22, "touchstart");
 return 0;
}
function _emscripten_glDeleteShader(id) {
 if (!id) return;
 var shader = GL.shaders[id];
 if (!shader) {
  GL.recordError(1281);
  return;
 }
 GLctx.deleteShader(shader);
 GL.shaders[id] = null;
}
function _pthread_attr_init(attr) {
 return 0;
}
function _emscripten_glDrawArraysInstanced(mode, first, count, primcount) {
 GLctx["drawArraysInstanced"](mode, first, count, primcount);
}
function _emscripten_glDeleteBuffers(n, buffers) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[buffers + i * 4 >> 2];
  var buffer = GL.buffers[id];
  if (!buffer) continue;
  GLctx.deleteBuffer(buffer);
  buffer.name = 0;
  GL.buffers[id] = null;
  if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
  if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
 }
}
function _emscripten_glTexParameteriv(target, pname, params) {
 var param = HEAP32[params >> 2];
 GLctx.texParameteri(target, pname, param);
}
function _emscripten_glUniformMatrix2fv(location, count, transpose, value) {
 location = GL.uniforms[location];
 var view;
 if (4 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[4 * count - 1];
  for (var i = 0; i < 4 * count; i += 4) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 16 >> 2);
 }
 GLctx.uniformMatrix2fv(location, !!transpose, view);
}
function ___syscall5(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var pathname = SYSCALLS.getStr(), flags = SYSCALLS.get(), mode = SYSCALLS.get();
  var stream = FS.open(pathname, flags, mode);
  return stream.fd;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall4(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get(), count = SYSCALLS.get();
  return FS.write(stream, HEAP8, buf, count);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _JS_UNETWebSockets_SocketRecvEvntTypeFromHost(hostId) {
 var evnt = UNETWebSocketsInstances.EventTypes.Nothing;
 if (UNETWebSocketsInstances.hosts[hostId].state == UNETWebSocketsInstances.HostStates.Opening) evnt = UNETWebSocketsInstances.EventTypes.ConnectEvent; else if (UNETWebSocketsInstances.hosts[hostId].messages.length != 0) evnt = UNETWebSocketsInstances.EventTypes.DataEvent; else if (UNETWebSocketsInstances.hosts[hostId].state == UNETWebSocketsInstances.HostStates.Closing) evnt = UNETWebSocketsInstances.EventTypes.DisconnectEvent;
 return evnt;
}
function _glGenVertexArrays(n, arrays) {
 for (var i = 0; i < n; i++) {
  var vao = GLctx["createVertexArray"]();
  if (!vao) {
   GL.recordError(1282);
   while (i < n) HEAP32[arrays + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.vaos);
  vao.name = id;
  GL.vaos[id] = vao;
  HEAP32[arrays + i * 4 >> 2] = id;
 }
}
function _glTexStorage3D(x0, x1, x2, x3, x4, x5) {
 GLctx["texStorage3D"](x0, x1, x2, x3, x4, x5);
}
function _emscripten_glEnableClientState() {
 Module["printErr"]("missing function: emscripten_glEnableClientState");
 abort(-1);
}
function _emscripten_glStencilMask(x0) {
 GLctx["stencilMask"](x0);
}
function _JS_Sound_SetListenerOrientation(x, y, z, xUp, yUp, zUp) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioContext.listener.setOrientation(-x, -y, -z, xUp, yUp, zUp);
}
function _JS_Eval_SetTimeout(func, arg, millis) {
 Module["noExitRuntime"] = true;
 function wrapper() {
  Runtime.getFuncWrapper(func, "vi")(arg);
 }
 return Browser.safeSetTimeout(wrapper, millis);
}
function __ZSt18uncaught_exceptionv() {
 return !!__ZSt18uncaught_exceptionv.uncaught_exception;
}
function ___cxa_begin_catch(ptr) {
 var info = EXCEPTIONS.infos[ptr];
 if (info && !info.caught) {
  info.caught = true;
  __ZSt18uncaught_exceptionv.uncaught_exception--;
 }
 if (info) info.rethrown = false;
 EXCEPTIONS.caught.push(ptr);
 EXCEPTIONS.addRef(EXCEPTIONS.deAdjust(ptr));
 return ptr;
}
function _glDeleteFramebuffers(n, framebuffers) {
 for (var i = 0; i < n; ++i) {
  var id = HEAP32[framebuffers + i * 4 >> 2];
  var framebuffer = GL.framebuffers[id];
  if (!framebuffer) continue;
  GLctx.deleteFramebuffer(framebuffer);
  framebuffer.name = 0;
  GL.framebuffers[id] = null;
 }
}
function _glDrawArrays(mode, first, count) {
 GLctx.drawArrays(mode, first, count);
}
function _emscripten_webgl_enable_extension(contextHandle, extension) {
 var context = GL.getContext(contextHandle);
 var extString = Pointer_stringify(extension);
 if (extString.indexOf("GL_") == 0) extString = extString.substr(3);
 var ext = context.GLctx.getExtension(extString);
 return ext ? 1 : 0;
}
function _emscripten_get_num_gamepads() {
 __emscripten_sample_gamepad_data();
 if (!JSEvents.lastGamepadState) return -1;
 return JSEvents.lastGamepadState.length;
}
function _emscripten_set_blur_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerFocusEventCallback(target, userData, useCapture, callbackfunc, 12, "blur");
 return 0;
}
function _mktime(tmPtr) {
 _tzset();
 var date = new Date(HEAP32[tmPtr + 20 >> 2] + 1900, HEAP32[tmPtr + 16 >> 2], HEAP32[tmPtr + 12 >> 2], HEAP32[tmPtr + 8 >> 2], HEAP32[tmPtr + 4 >> 2], HEAP32[tmPtr >> 2], 0);
 var dst = HEAP32[tmPtr + 32 >> 2];
 var guessedOffset = date.getTimezoneOffset();
 var start = new Date(date.getFullYear(), 0, 1);
 var summerOffset = (new Date(2e3, 6, 1)).getTimezoneOffset();
 var winterOffset = start.getTimezoneOffset();
 var dstOffset = Math.min(winterOffset, summerOffset);
 if (dst < 0) {
  HEAP32[tmPtr + 32 >> 2] = Number(dstOffset == guessedOffset);
 } else if (dst > 0 != (dstOffset == guessedOffset)) {
  var nonDstOffset = Math.max(winterOffset, summerOffset);
  var trueOffset = dst > 0 ? dstOffset : nonDstOffset;
  date.setTime(date.getTime() + (trueOffset - guessedOffset) * 6e4);
 }
 HEAP32[tmPtr + 24 >> 2] = date.getDay();
 var yday = (date.getTime() - start.getTime()) / (1e3 * 60 * 60 * 24) | 0;
 HEAP32[tmPtr + 28 >> 2] = yday;
 return date.getTime() / 1e3 | 0;
}
function _glClear(x0) {
 GLctx["clear"](x0);
}
function _glUniform2iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 2;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform2iv(location, value);
}
function _glIsEnabled(x0) {
 return GLctx["isEnabled"](x0);
}
function _glFramebufferTexture2D(target, attachment, textarget, texture, level) {
 GLctx.framebufferTexture2D(target, attachment, textarget, GL.textures[texture], level);
}
function _glGetFramebufferAttachmentParameteriv(target, attachment, pname, params) {
 var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
 HEAP32[params >> 2] = result;
}
function _emscripten_request_pointerlock(target, deferUntilInEventHandler) {
 if (!target) target = "#canvas";
 target = JSEvents.findEventTarget(target);
 if (!target) return -4;
 if (!target.requestPointerLock && !target.mozRequestPointerLock && !target.webkitRequestPointerLock && !target.msRequestPointerLock) {
  return -1;
 }
 var canPerformRequests = JSEvents.canPerformEventHandlerRequests();
 if (!canPerformRequests) {
  if (deferUntilInEventHandler) {
   JSEvents.deferCall(JSEvents.requestPointerLock, 2, [ target ]);
   return 1;
  } else {
   return -2;
  }
 }
 return JSEvents.requestPointerLock(target);
}
function _emscripten_glVertexAttrib2f(x0, x1, x2) {
 GLctx["vertexAttrib2f"](x0, x1, x2);
}
Module["_pthread_cond_broadcast"] = _pthread_cond_broadcast;
function _gettimeofday(ptr) {
 var now = Date.now();
 HEAP32[ptr >> 2] = now / 1e3 | 0;
 HEAP32[ptr + 4 >> 2] = now % 1e3 * 1e3 | 0;
 return 0;
}
function _glTexParameteriv(target, pname, params) {
 var param = HEAP32[params >> 2];
 GLctx.texParameteri(target, pname, param);
}
function _JS_Sound_SetVolume(channelInstance, v) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioInstances[channelInstance].gain.gain.value = v;
}
function _glGenFramebuffers(n, ids) {
 for (var i = 0; i < n; ++i) {
  var framebuffer = GLctx.createFramebuffer();
  if (!framebuffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[ids + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.framebuffers);
  framebuffer.name = id;
  GL.framebuffers[id] = framebuffer;
  HEAP32[ids + i * 4 >> 2] = id;
 }
}
function _emscripten_glGetTexParameteriv(target, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 HEAP32[params >> 2] = GLctx.getTexParameter(target, pname);
}
function ___syscall122(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var buf = SYSCALLS.get();
  if (!buf) return -ERRNO_CODES.EFAULT;
  var layout = {
   "sysname": 0,
   "nodename": 65,
   "domainname": 325,
   "machine": 260,
   "version": 195,
   "release": 130,
   "__size__": 390
  };
  function copyString(element, value) {
   var offset = layout[element];
   writeAsciiToMemory(value, buf + offset);
  }
  copyString("sysname", "Emscripten");
  copyString("nodename", "emscripten");
  copyString("release", "1.0");
  copyString("version", "#1");
  copyString("machine", "x86-JS");
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glDeleteVertexArrays(n, vaos) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[vaos + i * 4 >> 2];
  GLctx["deleteVertexArray"](GL.vaos[id]);
  GL.vaos[id] = null;
 }
}
function _emscripten_glSampleCoverage(value, invert) {
 GLctx.sampleCoverage(value, !!invert);
}
function _glIsVertexArray(array) {
 var vao = GL.vaos[array];
 if (!vao) return 0;
 return GLctx["isVertexArray"](vao);
}
function _glDisableVertexAttribArray(index) {
 GLctx.disableVertexAttribArray(index);
}
function _sysconf(name) {
 switch (name) {
 case 30:
  return PAGE_SIZE;
 case 85:
  return totalMemory / PAGE_SIZE;
 case 132:
 case 133:
 case 12:
 case 137:
 case 138:
 case 15:
 case 235:
 case 16:
 case 17:
 case 18:
 case 19:
 case 20:
 case 149:
 case 13:
 case 10:
 case 236:
 case 153:
 case 9:
 case 21:
 case 22:
 case 159:
 case 154:
 case 14:
 case 77:
 case 78:
 case 139:
 case 80:
 case 81:
 case 82:
 case 68:
 case 67:
 case 164:
 case 11:
 case 29:
 case 47:
 case 48:
 case 95:
 case 52:
 case 51:
 case 46:
  return 200809;
 case 79:
  return 0;
 case 27:
 case 246:
 case 127:
 case 128:
 case 23:
 case 24:
 case 160:
 case 161:
 case 181:
 case 182:
 case 242:
 case 183:
 case 184:
 case 243:
 case 244:
 case 245:
 case 165:
 case 178:
 case 179:
 case 49:
 case 50:
 case 168:
 case 169:
 case 175:
 case 170:
 case 171:
 case 172:
 case 97:
 case 76:
 case 32:
 case 173:
 case 35:
  return -1;
 case 176:
 case 177:
 case 7:
 case 155:
 case 8:
 case 157:
 case 125:
 case 126:
 case 92:
 case 93:
 case 129:
 case 130:
 case 131:
 case 94:
 case 91:
  return 1;
 case 74:
 case 60:
 case 69:
 case 70:
 case 4:
  return 1024;
 case 31:
 case 42:
 case 72:
  return 32;
 case 87:
 case 26:
 case 33:
  return 2147483647;
 case 34:
 case 1:
  return 47839;
 case 38:
 case 36:
  return 99;
 case 43:
 case 37:
  return 2048;
 case 0:
  return 2097152;
 case 3:
  return 65536;
 case 28:
  return 32768;
 case 44:
  return 32767;
 case 75:
  return 16384;
 case 39:
  return 1e3;
 case 89:
  return 700;
 case 71:
  return 256;
 case 40:
  return 255;
 case 2:
  return 100;
 case 180:
  return 64;
 case 25:
  return 20;
 case 5:
  return 16;
 case 6:
  return 6;
 case 73:
  return 4;
 case 84:
  {
   if (typeof navigator === "object") return navigator["hardwareConcurrency"] || 1;
   return 1;
  }
 }
 ___setErrNo(ERRNO_CODES.EINVAL);
 return -1;
}
function _emscripten_glMatrixMode() {
 throw "Legacy GL function (glMatrixMode) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.";
}
function _abort() {
 Module["abort"]();
}
function _JS_Log_Dump(ptr, type) {
 var str = Pointer_stringify(ptr);
 if (typeof dump == "function") dump(str);
 switch (type) {
 case 0:
 case 1:
 case 4:
  console.error(str);
  return;
 case 2:
  console.warn(str);
  return;
 case 3:
 case 5:
  console.log(str);
  return;
 default:
  console.error("Unknown console message type!");
  console.error(str);
 }
}
function _emscripten_glPolygonOffset(x0, x1) {
 GLctx["polygonOffset"](x0, x1);
}
function _glDisable(x0) {
 GLctx["disable"](x0);
}
function _emscripten_glIsBuffer(buffer) {
 var b = GL.buffers[buffer];
 if (!b) return 0;
 return GLctx.isBuffer(b);
}
var PTHREAD_SPECIFIC = {};
function _pthread_getspecific(key) {
 return PTHREAD_SPECIFIC[key] || 0;
}
function _glEnable(x0) {
 GLctx["enable"](x0);
}
function _glGetActiveUniformsiv(program, uniformCount, uniformIndices, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 if (uniformCount > 0 && uniformIndices == 0) {
  GL.recordError(1281);
  return;
 }
 program = GL.programs[program];
 var ids = [];
 for (var i = 0; i < uniformCount; i++) {
  ids.push(HEAP32[uniformIndices + i * 4 >> 2]);
 }
 var result = GLctx["getActiveUniforms"](program, ids, pname);
 if (!result) return;
 var len = result.length;
 for (var i = 0; i < len; i++) {
  HEAP32[params + i * 4 >> 2] = result[i];
 }
}
function emscriptenWebGLComputeImageSize(width, height, sizePerPixel, alignment) {
 function roundedToNextMultipleOf(x, y) {
  return Math.floor((x + y - 1) / y) * y;
 }
 var plainRowSize = width * sizePerPixel;
 var alignedRowSize = roundedToNextMultipleOf(plainRowSize, alignment);
 return height <= 0 ? 0 : (height - 1) * alignedRowSize + plainRowSize;
}
function emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat) {
 var sizePerPixel;
 var numChannels;
 switch (format) {
 case 6406:
 case 6409:
 case 6402:
 case 6403:
 case 36244:
  numChannels = 1;
  break;
 case 6410:
 case 33319:
 case 33320:
  numChannels = 2;
  break;
 case 6407:
 case 35904:
 case 36248:
  numChannels = 3;
  break;
 case 6408:
 case 35906:
 case 36249:
  numChannels = 4;
  break;
 default:
  GL.recordError(1280);
  return null;
 }
 switch (type) {
 case 5121:
 case 5120:
  sizePerPixel = numChannels * 1;
  break;
 case 5123:
 case 36193:
 case 5131:
 case 5122:
  sizePerPixel = numChannels * 2;
  break;
 case 5125:
 case 5126:
 case 5124:
  sizePerPixel = numChannels * 4;
  break;
 case 34042:
 case 35902:
 case 33640:
 case 35899:
 case 34042:
  sizePerPixel = 4;
  break;
 case 33635:
 case 32819:
 case 32820:
  sizePerPixel = 2;
  break;
 default:
  GL.recordError(1280);
  return null;
 }
 var bytes = emscriptenWebGLComputeImageSize(width, height, sizePerPixel, GL.unpackAlignment);
 switch (type) {
 case 5120:
  return HEAP8.subarray(pixels, pixels + bytes);
 case 5121:
  return HEAPU8.subarray(pixels, pixels + bytes);
 case 5122:
  return HEAP16.subarray(pixels >> 1, pixels + bytes >> 1);
 case 5124:
  return HEAP32.subarray(pixels >> 2, pixels + bytes >> 2);
 case 5126:
  return HEAPF32.subarray(pixels >> 2, pixels + bytes >> 2);
 case 5125:
 case 34042:
 case 35902:
 case 33640:
 case 35899:
 case 34042:
  return HEAPU32.subarray(pixels >> 2, pixels + bytes >> 2);
 case 5123:
 case 33635:
 case 32819:
 case 32820:
 case 36193:
 case 5131:
  return HEAPU16.subarray(pixels >> 1, pixels + bytes >> 1);
 default:
  GL.recordError(1280);
  return null;
 }
}
function _emscripten_glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
 var pixelData = null;
 if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, 0);
 GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
}
function _emscripten_glUniform2f(location, v0, v1) {
 location = GL.uniforms[location];
 GLctx.uniform2f(location, v0, v1);
}
function _glGetAttribLocation(program, name) {
 program = GL.programs[program];
 name = Pointer_stringify(name);
 return GLctx.getAttribLocation(program, name);
}
function _emscripten_glUniform2i(location, v0, v1) {
 location = GL.uniforms[location];
 GLctx.uniform2i(location, v0, v1);
}
function _emscripten_glDeleteRenderbuffers(n, renderbuffers) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[renderbuffers + i * 4 >> 2];
  var renderbuffer = GL.renderbuffers[id];
  if (!renderbuffer) continue;
  GLctx.deleteRenderbuffer(renderbuffer);
  renderbuffer.name = 0;
  GL.renderbuffers[id] = null;
 }
}
function ___cxa_pure_virtual() {
 ABORT = true;
 throw "Pure virtual function called!";
}
var _environ = STATICTOP;
STATICTOP += 16;
function ___buildEnvironment(env) {
 var MAX_ENV_VALUES = 64;
 var TOTAL_ENV_SIZE = 1024;
 var poolPtr;
 var envPtr;
 if (!___buildEnvironment.called) {
  ___buildEnvironment.called = true;
  ENV["USER"] = ENV["LOGNAME"] = "web_user";
  ENV["PATH"] = "/";
  ENV["PWD"] = "/";
  ENV["HOME"] = "/home/web_user";
  ENV["LANG"] = "C";
  ENV["_"] = Module["thisProgram"];
  poolPtr = allocate(TOTAL_ENV_SIZE, "i8", ALLOC_STATIC);
  envPtr = allocate(MAX_ENV_VALUES * 4, "i8*", ALLOC_STATIC);
  HEAP32[envPtr >> 2] = poolPtr;
  HEAP32[_environ >> 2] = envPtr;
 } else {
  envPtr = HEAP32[_environ >> 2];
  poolPtr = HEAP32[envPtr >> 2];
 }
 var strings = [];
 var totalSize = 0;
 for (var key in env) {
  if (typeof env[key] === "string") {
   var line = key + "=" + env[key];
   strings.push(line);
   totalSize += line.length;
  }
 }
 if (totalSize > TOTAL_ENV_SIZE) {
  throw new Error("Environment size exceeded TOTAL_ENV_SIZE!");
 }
 var ptrSize = 4;
 for (var i = 0; i < strings.length; i++) {
  var line = strings[i];
  writeAsciiToMemory(line, poolPtr);
  HEAP32[envPtr + i * ptrSize >> 2] = poolPtr;
  poolPtr += line.length + 1;
 }
 HEAP32[envPtr + strings.length * ptrSize >> 2] = 0;
}
var ENV = {};
function _unsetenv(name) {
 if (name === 0) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 name = Pointer_stringify(name);
 if (name === "" || name.indexOf("=") !== -1) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 if (ENV.hasOwnProperty(name)) {
  delete ENV[name];
  ___buildEnvironment(ENV);
 }
 return 0;
}
function _emscripten_set_mousedown_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 5, "mousedown");
 return 0;
}
function _emscripten_glDepthRange(x0, x1) {
 GLctx["depthRange"](x0, x1);
}
function _emscripten_set_fullscreenchange_callback(target, userData, useCapture, callbackfunc) {
 if (typeof JSEvents.fullscreenEnabled() === "undefined") return -1;
 if (!target) target = document; else {
  target = JSEvents.findEventTarget(target);
  if (!target) return -4;
 }
 JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "fullscreenchange");
 JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "mozfullscreenchange");
 JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "webkitfullscreenchange");
 JSEvents.registerFullscreenChangeEventCallback(target, userData, useCapture, callbackfunc, 19, "msfullscreenchange");
 return 0;
}
function _glPolygonOffset(x0, x1) {
 GLctx["polygonOffset"](x0, x1);
}
function _JS_WebRequest_SetProgressHandler(request, arg, onprogress) {
 var http = wr.requestInstances[request];
 http.onprogress = function http_onprogress(e) {
  if (onprogress) {
   if (e.lengthComputable) Runtime.dynCall("viii", onprogress, [ arg, e.loaded, e.total ]);
  }
 };
}
function _emscripten_glGetShaderPrecisionFormat(shaderType, precisionType, range, precision) {
 var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
 HEAP32[range >> 2] = result.rangeMin;
 HEAP32[range + 4 >> 2] = result.rangeMax;
 HEAP32[precision >> 2] = result.precision;
}
function _JS_WebRequest_GetStatusLine(request, buffer, bufferSize) {
 var status = wr.requestInstances[request].status + " " + wr.requestInstances[request].statusText;
 if (buffer) stringToUTF8(status, buffer, bufferSize);
 return lengthBytesUTF8(status);
}
function _emscripten_set_wheel_callback(target, userData, useCapture, callbackfunc) {
 target = JSEvents.findEventTarget(target);
 if (typeof target.onwheel !== "undefined") {
  JSEvents.registerWheelEventCallback(target, userData, useCapture, callbackfunc, 9, "wheel");
  return 0;
 } else if (typeof target.onmousewheel !== "undefined") {
  JSEvents.registerWheelEventCallback(target, userData, useCapture, callbackfunc, 9, "mousewheel");
  return 0;
 } else {
  return -1;
 }
}
function _glDrawElementsInstanced(mode, count, type, indices, primcount) {
 GLctx["drawElementsInstanced"](mode, count, type, indices, primcount);
}
function _emscripten_glBindProgramARB() {
 Module["printErr"]("missing function: emscripten_glBindProgramARB");
 abort(-1);
}
function _emscripten_glVertexAttrib3fv(index, v) {
 var view = GL.miniTempBufferViews[2];
 view[0] = HEAPF32[v >> 2];
 view[1] = HEAPF32[v + 4 >> 2];
 view[2] = HEAPF32[v + 8 >> 2];
 GLctx.vertexAttrib3fv(index, view);
}
function _glFlush() {
 GLctx["flush"]();
}
function _emscripten_glIsFramebuffer(framebuffer) {
 var fb = GL.framebuffers[framebuffer];
 if (!fb) return 0;
 return GLctx.isFramebuffer(fb);
}
function ___syscall193(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), zero = SYSCALLS.getZero(), length = SYSCALLS.get64();
  FS.truncate(path, length);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall192(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var addr = SYSCALLS.get(), len = SYSCALLS.get(), prot = SYSCALLS.get(), flags = SYSCALLS.get(), fd = SYSCALLS.get(), off = SYSCALLS.get();
  off <<= 12;
  var ptr;
  var allocated = false;
  if (fd === -1) {
   ptr = _memalign(PAGE_SIZE, len);
   if (!ptr) return -ERRNO_CODES.ENOMEM;
   _memset(ptr, 0, len);
   allocated = true;
  } else {
   var info = FS.getStream(fd);
   if (!info) return -ERRNO_CODES.EBADF;
   var res = FS.mmap(info, HEAPU8, addr, len, off, prot, flags);
   ptr = res.ptr;
   allocated = res.allocated;
  }
  SYSCALLS.mappings[ptr] = {
   malloc: ptr,
   len: len,
   allocated: allocated,
   fd: fd,
   flags: flags
  };
  return ptr;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall195(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), buf = SYSCALLS.get();
  return SYSCALLS.doStat(FS.stat, path, buf);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall194(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var fd = SYSCALLS.get(), zero = SYSCALLS.getZero(), length = SYSCALLS.get64();
  FS.ftruncate(fd, length);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall197(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get();
  return SYSCALLS.doStat(FS.stat, stream.path, buf);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall196(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), buf = SYSCALLS.get();
  return SYSCALLS.doStat(FS.lstat, path, buf);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall202(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall199() {
 return ___syscall202.apply(null, arguments);
}
function _emscripten_glRotatef() {
 Module["printErr"]("missing function: emscripten_glRotatef");
 abort(-1);
}
function _glFenceSync(condition, flags) {
 var sync = GLctx.fenceSync(condition, flags);
 if (sync) {
  var id = GL.getNewId(GL.syncs);
  sync.name = id;
  GL.syncs[id] = sync;
  return id;
 } else {
  return 0;
 }
}
function _glBlendEquationSeparate(x0, x1) {
 GLctx["blendEquationSeparate"](x0, x1);
}
function _emscripten_set_focus_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerFocusEventCallback(target, userData, useCapture, callbackfunc, 13, "focus");
 return 0;
}
function _emscripten_glGetShaderInfoLog(shader, maxLength, length, infoLog) {
 var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
 if (log === null) log = "(unknown error)";
 if (maxLength > 0 && infoLog) {
  var numBytesWrittenExclNull = stringToUTF8(log, infoLog, maxLength);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
function _emscripten_set_mouseup_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 6, "mouseup");
 return 0;
}
function _emscripten_glStencilOpSeparate(x0, x1, x2, x3) {
 GLctx["stencilOpSeparate"](x0, x1, x2, x3);
}
function _emscripten_glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
 var heapView;
 if (data) {
  heapView = HEAPU8.subarray(data, data + imageSize);
 } else {
  heapView = null;
 }
 GLctx["compressedTexSubImage2D"](target, level, xoffset, yoffset, width, height, format, heapView);
}
Module["_bitshift64Ashr"] = _bitshift64Ashr;
function _glStencilFuncSeparate(x0, x1, x2, x3) {
 GLctx["stencilFuncSeparate"](x0, x1, x2, x3);
}
function _JS_UNETWebSockets_SocketClose(hostId) {
 var socket = UNETWebSocketsInstances.hosts[hostId];
 if (socket.socket != null) socket.socket.close();
}
function _pthread_cleanup_push(routine, arg) {
 __ATEXIT__.push((function() {
  Module["dynCall_vi"](routine, arg);
 }));
 _pthread_cleanup_push.level = __ATEXIT__.length;
}
function _emscripten_glIsEnabled(x0) {
 return GLctx["isEnabled"](x0);
}
function _glUniform4iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 4;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform4iv(location, value);
}
function _glClearStencil(x0) {
 GLctx["clearStencil"](x0);
}
function _JS_Sound_SetPosition(channelInstance, x, y, z) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioInstances[channelInstance].panner.setPosition(x, y, z);
}
function _emscripten_glClearDepthf(x0) {
 GLctx["clearDepth"](x0);
}
function _emscripten_glVertexAttrib4f(x0, x1, x2, x3, x4) {
 GLctx["vertexAttrib4f"](x0, x1, x2, x3, x4);
}
function ___cxa_rethrow() {
 var ptr = EXCEPTIONS.caught.pop();
 if (!EXCEPTIONS.infos[ptr].rethrown) {
  EXCEPTIONS.caught.push(ptr);
  EXCEPTIONS.infos[ptr].rethrown = true;
 }
 EXCEPTIONS.last = ptr;
 throw ptr;
}
function _JS_UNETWebSockets_SocketRecvEvntBuffLengthFromHost(hostId) {
 return UNETWebSocketsInstances.hosts[hostId].messages[0].length;
}
function _emscripten_glClear(x0) {
 GLctx["clear"](x0);
}
function _emscripten_get_now_is_monotonic() {
 return ENVIRONMENT_IS_NODE || typeof dateNow !== "undefined" || (ENVIRONMENT_IS_WEB || ENVIRONMENT_IS_WORKER) && self["performance"] && self["performance"]["now"];
}
function _clock_gettime(clk_id, tp) {
 var now;
 if (clk_id === 0) {
  now = Date.now();
 } else if (clk_id === 1 && _emscripten_get_now_is_monotonic()) {
  now = _emscripten_get_now();
 } else {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 HEAP32[tp >> 2] = now / 1e3 | 0;
 HEAP32[tp + 4 >> 2] = now % 1e3 * 1e3 * 1e3 | 0;
 return 0;
}
function _glDeleteRenderbuffers(n, renderbuffers) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[renderbuffers + i * 4 >> 2];
  var renderbuffer = GL.renderbuffers[id];
  if (!renderbuffer) continue;
  GLctx.deleteRenderbuffer(renderbuffer);
  renderbuffer.name = 0;
  GL.renderbuffers[id] = null;
 }
}
function _glGetProgramiv(program, pname, p) {
 if (!p) {
  GL.recordError(1281);
  return;
 }
 if (program >= GL.counter) {
  GL.recordError(1281);
  return;
 }
 var ptable = GL.programInfos[program];
 if (!ptable) {
  GL.recordError(1282);
  return;
 }
 if (pname == 35716) {
  var log = GLctx.getProgramInfoLog(GL.programs[program]);
  if (log === null) log = "(unknown error)";
  HEAP32[p >> 2] = log.length + 1;
 } else if (pname == 35719) {
  HEAP32[p >> 2] = ptable.maxUniformLength;
 } else if (pname == 35722) {
  if (ptable.maxAttributeLength == -1) {
   var program = GL.programs[program];
   var numAttribs = GLctx.getProgramParameter(program, GLctx.ACTIVE_ATTRIBUTES);
   ptable.maxAttributeLength = 0;
   for (var i = 0; i < numAttribs; ++i) {
    var activeAttrib = GLctx.getActiveAttrib(program, i);
    ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length + 1);
   }
  }
  HEAP32[p >> 2] = ptable.maxAttributeLength;
 } else if (pname == 35381) {
  if (ptable.maxUniformBlockNameLength == -1) {
   var program = GL.programs[program];
   var numBlocks = GLctx.getProgramParameter(program, GLctx.ACTIVE_UNIFORM_BLOCKS);
   ptable.maxUniformBlockNameLength = 0;
   for (var i = 0; i < numBlocks; ++i) {
    var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
    ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length + 1);
   }
  }
  HEAP32[p >> 2] = ptable.maxUniformBlockNameLength;
 } else {
  HEAP32[p >> 2] = GLctx.getProgramParameter(GL.programs[program], pname);
 }
}
function _glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
 GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
}
function _pthread_cond_signal() {
 return 0;
}
function _glFramebufferTextureLayer(target, attachment, texture, level, layer) {
 GLctx.framebufferTextureLayer(target, attachment, GL.textures[texture], level, layer);
}
function _emscripten_glGetAttachedShaders(program, maxCount, count, shaders) {
 var result = GLctx.getAttachedShaders(GL.programs[program]);
 var len = result.length;
 if (len > maxCount) {
  len = maxCount;
 }
 HEAP32[count >> 2] = len;
 for (var i = 0; i < len; ++i) {
  var id = GL.shaders.indexOf(result[i]);
  assert(id !== -1, "shader not bound to local id");
  HEAP32[shaders + i * 4 >> 2] = id;
 }
}
function _flock(fd, operation) {
 return 0;
}
function _emscripten_glFrontFace(x0) {
 GLctx["frontFace"](x0);
}
function _emscripten_glActiveTexture(x0) {
 GLctx["activeTexture"](x0);
}
function _glTexStorage2D(x0, x1, x2, x3, x4) {
 GLctx["texStorage2D"](x0, x1, x2, x3, x4);
}
function _emscripten_glGetInfoLogARB() {
 Module["printErr"]("missing function: emscripten_glGetInfoLogARB");
 abort(-1);
}
function _pthread_key_delete(key) {
 if (key in PTHREAD_SPECIFIC) {
  delete PTHREAD_SPECIFIC[key];
  return 0;
 }
 return ERRNO_CODES.EINVAL;
}
function _glGenQueries(n, ids) {
 for (var i = 0; i < n; i++) {
  var query = GLctx["createQuery"]();
  if (!query) {
   GL.recordError(1282);
   while (i < n) HEAP32[ids + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.queries);
  query.name = id;
  GL.queries[id] = query;
  HEAP32[ids + i * 4 >> 2] = id;
 }
}
function _emscripten_glRenderbufferStorage(x0, x1, x2, x3) {
 GLctx["renderbufferStorage"](x0, x1, x2, x3);
}
function _glTexSubImage3D(target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, data) {
 GLctx["texSubImage3D"](target, level, xoffset, yoffset, zoffset, width, height, depth, format, type, HEAPU8.subarray(data));
}
function _glDeleteSamplers(n, samplers) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[samplers + i * 4 >> 2];
  var sampler = GL.samplers[id];
  if (!sampler) continue;
  GLctx["deleteSampler"](sampler);
  sampler.name = 0;
  GL.samplers[id] = null;
 }
}
function ___syscall10(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr();
  FS.unlink(path);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glCopyTexImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
 GLctx["copyTexImage2D"](x0, x1, x2, x3, x4, x5, x6, x7);
}
function _glBlitFramebuffer(x0, x1, x2, x3, x4, x5, x6, x7, x8, x9) {
 GLctx["blitFramebuffer"](x0, x1, x2, x3, x4, x5, x6, x7, x8, x9);
}
function _llvm_trap() {
 abort("trap!");
}
function _emscripten_glIsProgram(program) {
 var program = GL.programs[program];
 if (!program) return 0;
 return GLctx.isProgram(program);
}
function _emscripten_webgl_init_context_attributes(attributes) {
 HEAP32[attributes >> 2] = 1;
 HEAP32[attributes + 4 >> 2] = 1;
 HEAP32[attributes + 8 >> 2] = 0;
 HEAP32[attributes + 12 >> 2] = 1;
 HEAP32[attributes + 16 >> 2] = 1;
 HEAP32[attributes + 20 >> 2] = 0;
 HEAP32[attributes + 24 >> 2] = 0;
 HEAP32[attributes + 28 >> 2] = 0;
 HEAP32[attributes + 32 >> 2] = 1;
 HEAP32[attributes + 36 >> 2] = 0;
 HEAP32[attributes + 40 >> 2] = 1;
 HEAP32[attributes + 44 >> 2] = 0;
}
function _emscripten_glGenBuffers(n, buffers) {
 for (var i = 0; i < n; i++) {
  var buffer = GLctx.createBuffer();
  if (!buffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[buffers + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.buffers);
  buffer.name = id;
  GL.buffers[id] = buffer;
  HEAP32[buffers + i * 4 >> 2] = id;
 }
}
function _JS_Sound_SetLoopPoints(channelInstance, loopStart, loopEnd) {
 if (WEBAudio.audioWebEnabled == 0) return;
 var channel = WEBAudio.audioInstances[channelInstance];
 channel.source.loopStart = loopStart;
 channel.source.loopEnd = loopEnd;
}
function _emscripten_glGetShaderiv(shader, pname, p) {
 if (!p) {
  GL.recordError(1281);
  return;
 }
 if (pname == 35716) {
  var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
  if (log === null) log = "(unknown error)";
  HEAP32[p >> 2] = log.length + 1;
 } else {
  HEAP32[p >> 2] = GLctx.getShaderParameter(GL.shaders[shader], pname);
 }
}
function _emscripten_glUniformMatrix3fv(location, count, transpose, value) {
 location = GL.uniforms[location];
 var view;
 if (9 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[9 * count - 1];
  for (var i = 0; i < 9 * count; i += 9) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
   view[i + 4] = HEAPF32[value + (4 * i + 16) >> 2];
   view[i + 5] = HEAPF32[value + (4 * i + 20) >> 2];
   view[i + 6] = HEAPF32[value + (4 * i + 24) >> 2];
   view[i + 7] = HEAPF32[value + (4 * i + 28) >> 2];
   view[i + 8] = HEAPF32[value + (4 * i + 32) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 36 >> 2);
 }
 GLctx.uniformMatrix3fv(location, !!transpose, view);
}
Module["_testSetjmp"] = _testSetjmp;
function _JS_SystemInfo_GetCurrentCanvasWidth() {
 return Module["canvas"].clientWidth;
}
function _JS_UNETWebSockets_IsHostCorrect(i) {
 if (i < UNETWebSocketsInstances.hosts.length && UNETWebSocketsInstances.hosts[i] != null && UNETWebSocketsInstances.hosts[i].socket != null) {
  return true;
 }
 return false;
}
function _glUniform4uiv(location, count, value) {
 location = GL.uniforms[location];
 count *= 4;
 value = HEAPU32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform4uiv(location, value);
}
function _emscripten_glGenFramebuffers(n, ids) {
 for (var i = 0; i < n; ++i) {
  var framebuffer = GLctx.createFramebuffer();
  if (!framebuffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[ids + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.framebuffers);
  framebuffer.name = id;
  GL.framebuffers[id] = framebuffer;
  HEAP32[ids + i * 4 >> 2] = id;
 }
}
function _JS_Sound_Play(bufferInstance, channelInstance, offset, delay) {
 _JS_Sound_Stop(channelInstance, 0);
 if (WEBAudio.audioWebEnabled == 0) return;
 var sound = WEBAudio.audioInstances[bufferInstance];
 var channel = WEBAudio.audioInstances[channelInstance];
 if (sound.buffer) channel.playBuffer(WEBAudio.audioContext.currentTime + delay, sound.buffer, offset); else console.log("Trying to play sound which is not loaded.");
}
function _glGetShaderiv(shader, pname, p) {
 if (!p) {
  GL.recordError(1281);
  return;
 }
 if (pname == 35716) {
  var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
  if (log === null) log = "(unknown error)";
  HEAP32[p >> 2] = log.length + 1;
 } else {
  HEAP32[p >> 2] = GLctx.getShaderParameter(GL.shaders[shader], pname);
 }
}
function _emscripten_glBlendEquationSeparate(x0, x1) {
 GLctx["blendEquationSeparate"](x0, x1);
}
function _emscripten_glDrawElements(mode, count, type, indices) {
 GLctx.drawElements(mode, count, type, indices);
}
function _emscripten_glDrawRangeElements(mode, start, end, count, type, indices) {
 _emscripten_glDrawElements(mode, count, type, indices);
 GLctx.drawElements(mode, count, type, indices);
}
function _glGenRenderbuffers(n, renderbuffers) {
 for (var i = 0; i < n; i++) {
  var renderbuffer = GLctx.createRenderbuffer();
  if (!renderbuffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[renderbuffers + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.renderbuffers);
  renderbuffer.name = id;
  GL.renderbuffers[id] = renderbuffer;
  HEAP32[renderbuffers + i * 4 >> 2] = id;
 }
}
function _emscripten_glGenTextures(n, textures) {
 for (var i = 0; i < n; i++) {
  var texture = GLctx.createTexture();
  if (!texture) {
   GL.recordError(1282);
   while (i < n) HEAP32[textures + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.textures);
  texture.name = id;
  GL.textures[id] = texture;
  HEAP32[textures + i * 4 >> 2] = id;
 }
}
function _emscripten_glReleaseShaderCompiler() {}
function _emscripten_glGetActiveUniform(program, index, bufSize, length, size, type, name) {
 program = GL.programs[program];
 var info = GLctx.getActiveUniform(program, index);
 if (!info) return;
 if (bufSize > 0 && name) {
  var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
 if (size) HEAP32[size >> 2] = info.size;
 if (type) HEAP32[type >> 2] = info.type;
}
function _JS_Sound_ReleaseInstance(instance) {
 WEBAudio.audioInstances[instance] = null;
}
function _emscripten_glDrawArrays(mode, first, count) {
 GLctx.drawArrays(mode, first, count);
}
function _emscripten_glClearDepth(x0) {
 GLctx["clearDepth"](x0);
}
var fs = {
 numPendingSync: 0,
 syncIntervalID: 0,
 syncInProgress: false,
 sync: (function(onlyPendingSync) {
  if (onlyPendingSync) {
   if (fs.numPendingSync == 0) return;
  } else if (fs.syncInProgress) {
   fs.numPendingSync++;
   return;
  }
  fs.syncInProgress = true;
  FS.syncfs(false, (function(err) {
   fs.syncInProgress = false;
  }));
  fs.numPendingSync = 0;
 })
};
function _JS_FileSystem_SetSyncInterval(ms) {
 if (!Module.indexedDB) return;
 fs.syncIntervalID = window.setInterval((function() {
  fs.sync(true);
 }), ms);
}
function _emscripten_glGetUniformLocation(program, name) {
 name = Pointer_stringify(name);
 var arrayOffset = 0;
 if (name.indexOf("]", name.length - 1) !== -1) {
  var ls = name.lastIndexOf("[");
  var arrayIndex = name.slice(ls + 1, -1);
  if (arrayIndex.length > 0) {
   arrayOffset = parseInt(arrayIndex);
   if (arrayOffset < 0) {
    return -1;
   }
  }
  name = name.slice(0, ls);
 }
 var ptable = GL.programInfos[program];
 if (!ptable) {
  return -1;
 }
 var utable = ptable.uniforms;
 var uniformInfo = utable[name];
 if (uniformInfo && arrayOffset < uniformInfo[0]) {
  return uniformInfo[1] + arrayOffset;
 } else {
  return -1;
 }
}
function _glUniform3fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (3 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[3 * count - 1];
  for (var i = 0; i < 3 * count; i += 3) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 12 >> 2);
 }
 GLctx.uniform3fv(location, view);
}
function _emscripten_glVertexAttrib4fv(index, v) {
 var view = GL.miniTempBufferViews[3];
 view[0] = HEAPF32[v >> 2];
 view[1] = HEAPF32[v + 4 >> 2];
 view[2] = HEAPF32[v + 8 >> 2];
 view[3] = HEAPF32[v + 12 >> 2];
 GLctx.vertexAttrib4fv(index, view);
}
function _emscripten_glScissor(x0, x1, x2, x3) {
 GLctx["scissor"](x0, x1, x2, x3);
}
Module["_bitshift64Lshr"] = _bitshift64Lshr;
function _JS_Sound_Set3D(channelInstance, threeD) {
 var channel = WEBAudio.audioInstances[channelInstance];
 if (channel.threeD != threeD) {
  channel.threeD = threeD;
  channel.setupPanning();
 }
}
function _JS_SystemInfo_GetDocumentURL(buffer, bufferSize) {
 if (buffer) stringToUTF8(document.URL, buffer, bufferSize);
 return lengthBytesUTF8(document.URL);
}
function _emscripten_glLinkProgram(program) {
 GLctx.linkProgram(GL.programs[program]);
 GL.programInfos[program] = null;
 GL.populateUniformTable(program);
}
function _JS_Sound_GetLength(bufferInstance) {
 if (WEBAudio.audioWebEnabled == 0) return 0;
 var sound = WEBAudio.audioInstances[bufferInstance];
 var sampleRateRatio = 44100 / sound.buffer.sampleRate;
 return sound.buffer.length * sampleRateRatio;
}
function _JS_Sound_Create_Channel(callback, userData) {
 if (WEBAudio.audioWebEnabled == 0) return;
 var channel = {
  gain: WEBAudio.audioContext.createGain(),
  panner: WEBAudio.audioContext.createPanner(),
  threeD: false,
  playBuffer: (function(delay, buffer, offset) {
   this.source.buffer = buffer;
   var chan = this;
   this.source.onended = (function() {
    if (callback) Runtime.dynCall("vi", callback, [ userData ]);
    chan.setup();
   });
   this.source.start(delay, offset);
  }),
  setup: (function() {
   this.source = WEBAudio.audioContext.createBufferSource();
   this.setupPanning();
  }),
  setupPanning: (function() {
   if (this.threeD) {
    this.source.disconnect();
    this.source.connect(this.panner);
    this.panner.connect(this.gain);
   } else {
    this.panner.disconnect();
    this.source.connect(this.gain);
   }
  })
 };
 channel.panner.rolloffFactor = 0;
 channel.gain.connect(WEBAudio.audioContext.destination);
 channel.setup();
 return WEBAudio.audioInstances.push(channel) - 1;
}
function _glDeleteSync(id) {
 if (!id) return;
 var sync = GL.syncs[id];
 if (!sync) {
  GL.recordError(1281);
  return;
 }
 GLctx.deleteSync(sync);
 sync.name = 0;
 GL.syncs[id] = null;
}
function _realloc() {
 throw "bad";
}
Module["_realloc"] = _realloc;
Module["_saveSetjmp"] = _saveSetjmp;
function _longjmp(env, value) {
 asm["setThrew"](env, value || 1);
 throw "longjmp";
}
function _emscripten_longjmp(env, value) {
 _longjmp(env, value);
}
function ___cxa_find_matching_catch_4() {
 return ___cxa_find_matching_catch.apply(null, arguments);
}
function emscriptenWebGLGetVertexAttrib(index, pname, params, type) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 var data = GLctx.getVertexAttrib(index, pname);
 if (pname == 34975) {
  HEAP32[params >> 2] = data["name"];
 } else if (typeof data == "number" || typeof data == "boolean") {
  switch (type) {
  case "Integer":
   HEAP32[params >> 2] = data;
   break;
  case "Float":
   HEAPF32[params >> 2] = data;
   break;
  case "FloatToInteger":
   HEAP32[params >> 2] = Math.fround(data);
   break;
  default:
   throw "internal emscriptenWebGLGetVertexAttrib() error, bad type: " + type;
  }
 } else {
  for (var i = 0; i < data.length; i++) {
   switch (type) {
   case "Integer":
    HEAP32[params + i >> 2] = data[i];
    break;
   case "Float":
    HEAPF32[params + i >> 2] = data[i];
    break;
   case "FloatToInteger":
    HEAP32[params + i >> 2] = Math.fround(data[i]);
    break;
   default:
    throw "internal emscriptenWebGLGetVertexAttrib() error, bad type: " + type;
   }
  }
 }
}
function _glGetVertexAttribiv(index, pname, params) {
 emscriptenWebGLGetVertexAttrib(index, pname, params, "FloatToInteger");
}
function ___cxa_find_matching_catch_2() {
 return ___cxa_find_matching_catch.apply(null, arguments);
}
function ___cxa_find_matching_catch_3() {
 return ___cxa_find_matching_catch.apply(null, arguments);
}
function _JS_FileSystem_Sync() {
 if (!Module.indexedDB) return;
 fs.sync(false);
}
function _emscripten_glEnable(x0) {
 GLctx["enable"](x0);
}
function _emscripten_glBufferData(target, size, data, usage) {
 switch (usage) {
 case 35041:
 case 35042:
  usage = 35040;
  break;
 case 35045:
 case 35046:
  usage = 35044;
  break;
 case 35049:
 case 35050:
  usage = 35048;
  break;
 }
 if (!data) {
  GLctx.bufferData(target, size, usage);
 } else {
  GLctx.bufferData(target, HEAPU8.subarray(data, data + size), usage);
 }
}
function _glGetActiveUniformBlockiv(program, uniformBlockIndex, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 program = GL.programs[program];
 switch (pname) {
 case 35393:
  var name = GLctx["getActiveUniformBlockName"](program, uniformBlockIndex);
  HEAP32[params >> 2] = name.length + 1;
  return;
 default:
  var result = GLctx["getActiveUniformBlockParameter"](program, uniformBlockIndex, pname);
  if (!result) return;
  if (typeof result == "number") {
   HEAP32[params >> 2] = result;
  } else {
   for (var i = 0; i < result.length; i++) {
    HEAP32[params + i * 4 >> 2] = result[i];
   }
  }
 }
}
function _emscripten_glGetShaderSource(shader, bufSize, length, source) {
 var result = GLctx.getShaderSource(GL.shaders[shader]);
 if (!result) return;
 if (bufSize > 0 && source) {
  var numBytesWrittenExclNull = stringToUTF8(result, source, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
Module["_llvm_bswap_i32"] = _llvm_bswap_i32;
function _JS_Sound_GetLoadState(bufferInstance) {
 if (WEBAudio.audioWebEnabled == 0) return 2;
 var sound = WEBAudio.audioInstances[bufferInstance];
 if (sound.error) return 2;
 if (sound.buffer) return 0;
 return 1;
}
function _JS_Sound_SetPitch(channelInstance, v) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioInstances[channelInstance].source.playbackRate.value = v;
}
function emscriptenWebGLGet(name_, p, type) {
 if (!p) {
  GL.recordError(1281);
  return;
 }
 var ret = undefined;
 switch (name_) {
 case 36346:
  ret = 1;
  break;
 case 36344:
  if (type !== "Integer" && type !== "Integer64") {
   GL.recordError(1280);
  }
  return;
 case 34814:
 case 36345:
  ret = 0;
  break;
 case 34466:
  var formats = GLctx.getParameter(34467);
  ret = formats.length;
  break;
 case 33309:
  if (GLctx.canvas.GLctxObject.version < 2) {
   GL.recordError(1282);
   return;
  }
  var exts = GLctx.getSupportedExtensions();
  ret = 2 * exts.length;
  break;
 case 33307:
 case 33308:
  if (GLctx.canvas.GLctxObject.version < 2) {
   GL.recordError(1280);
   return;
  }
  ret = name_ == 33307 ? 3 : 0;
  break;
 }
 if (ret === undefined) {
  var result = GLctx.getParameter(name_);
  switch (typeof result) {
  case "number":
   ret = result;
   break;
  case "boolean":
   ret = result ? 1 : 0;
   break;
  case "string":
   GL.recordError(1280);
   return;
  case "object":
   if (result === null) {
    switch (name_) {
    case 34964:
    case 35725:
    case 34965:
    case 36006:
    case 36007:
    case 32873:
    case 34229:
    case 35097:
    case 36389:
    case 34068:
     {
      ret = 0;
      break;
     }
    default:
     {
      GL.recordError(1280);
      return;
     }
    }
   } else if (result instanceof Float32Array || result instanceof Uint32Array || result instanceof Int32Array || result instanceof Array) {
    for (var i = 0; i < result.length; ++i) {
     switch (type) {
     case "Integer":
      HEAP32[p + i * 4 >> 2] = result[i];
      break;
     case "Float":
      HEAPF32[p + i * 4 >> 2] = result[i];
      break;
     case "Boolean":
      HEAP8[p + i >> 0] = result[i] ? 1 : 0;
      break;
     default:
      throw "internal glGet error, bad type: " + type;
     }
    }
    return;
   } else if (result instanceof WebGLBuffer || result instanceof WebGLProgram || result instanceof WebGLFramebuffer || result instanceof WebGLRenderbuffer || result instanceof WebGLQuery || result instanceof WebGLSampler || result instanceof WebGLSync || result instanceof WebGLTransformFeedback || result instanceof WebGLVertexArrayObject || result instanceof WebGLTexture) {
    ret = result.name | 0;
   } else {
    GL.recordError(1280);
    return;
   }
   break;
  default:
   GL.recordError(1280);
   return;
  }
 }
 switch (type) {
 case "Integer64":
  tempI64 = [ ret >>> 0, (tempDouble = ret, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0) ], HEAP32[p >> 2] = tempI64[0], HEAP32[p + 4 >> 2] = tempI64[1];
  break;
 case "Integer":
  HEAP32[p >> 2] = ret;
  break;
 case "Float":
  HEAPF32[p >> 2] = ret;
  break;
 case "Boolean":
  HEAP8[p >> 0] = ret ? 1 : 0;
  break;
 default:
  throw "internal glGet error, bad type: " + type;
 }
}
function _emscripten_glGetFloatv(name_, p) {
 emscriptenWebGLGet(name_, p, "Float");
}
function _glGetProgramInfoLog(program, maxLength, length, infoLog) {
 var log = GLctx.getProgramInfoLog(GL.programs[program]);
 if (log === null) log = "(unknown error)";
 if (maxLength > 0 && infoLog) {
  var numBytesWrittenExclNull = stringToUTF8(log, infoLog, maxLength);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
function _emscripten_glUniform3fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (3 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[3 * count - 1];
  for (var i = 0; i < 3 * count; i += 3) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 12 >> 2);
 }
 GLctx.uniform3fv(location, view);
}
function _glBindTransformFeedback(target, id) {
 var transformFeedback = id ? GL.transformFeedbacks[id] : null;
 if (id && !transformFeedback) {
  GL.recordError(1282);
  return;
 }
 GLctx["bindTransformFeedback"](target, transformFeedback);
}
function _glBindVertexArray(vao) {
 GLctx["bindVertexArray"](GL.vaos[vao]);
}
function ___resumeException(ptr) {
 if (!EXCEPTIONS.last) {
  EXCEPTIONS.last = ptr;
 }
 throw ptr;
}
function _emscripten_glCreateProgram() {
 var id = GL.getNewId(GL.programs);
 var program = GLctx.createProgram();
 program.name = id;
 GL.programs[id] = program;
 return id;
}
function _pthread_once(ptr, func) {
 if (!_pthread_once.seen) _pthread_once.seen = {};
 if (ptr in _pthread_once.seen) return;
 Module["dynCall_v"](func);
 _pthread_once.seen[ptr] = 1;
}
function _emscripten_glCompressedTexImage2D(target, level, internalFormat, width, height, border, imageSize, data) {
 var heapView;
 if (data) {
  heapView = HEAPU8.subarray(data, data + imageSize);
 } else {
  heapView = null;
 }
 GLctx["compressedTexImage2D"](target, level, internalFormat, width, height, border, heapView);
}
function _emscripten_glClearColor(x0, x1, x2, x3) {
 GLctx["clearColor"](x0, x1, x2, x3);
}
function _glUniform2uiv(location, count, value) {
 location = GL.uniforms[location];
 count *= 2;
 value = HEAPU32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform2uiv(location, value);
}
function _pthread_attr_destroy(attr) {
 return 0;
}
function _JS_SystemInfo_HasWebGL() {
 return UnityLoader.SystemInfo.hasWebGL;
}
function _glFinish() {
 GLctx["finish"]();
}
function _emscripten_glLoadMatrixf() {
 Module["printErr"]("missing function: emscripten_glLoadMatrixf");
 abort(-1);
}
function _glDeleteShader(id) {
 if (!id) return;
 var shader = GL.shaders[id];
 if (!shader) {
  GL.recordError(1281);
  return;
 }
 GLctx.deleteShader(shader);
 GL.shaders[id] = null;
}
function _emscripten_glGetProgramInfoLog(program, maxLength, length, infoLog) {
 var log = GLctx.getProgramInfoLog(GL.programs[program]);
 if (log === null) log = "(unknown error)";
 if (maxLength > 0 && infoLog) {
  var numBytesWrittenExclNull = stringToUTF8(log, infoLog, maxLength);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
function _glViewport(x0, x1, x2, x3) {
 GLctx["viewport"](x0, x1, x2, x3);
}
function _emscripten_glDepthMask(flag) {
 GLctx.depthMask(!!flag);
}
function _glUniform1uiv(location, count, value) {
 location = GL.uniforms[location];
 value = HEAPU32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform1uiv(location, value);
}
function _glTransformFeedbackVaryings(program, count, varyings, bufferMode) {
 program = GL.programs[program];
 var vars = [];
 for (var i = 0; i < count; i++) vars.push(Pointer_stringify(HEAP32[varyings + i * 4 >> 2]));
 GLctx["transformFeedbackVaryings"](program, vars, bufferMode);
}
function _JS_Sound_Init() {
 try {
  window.AudioContext = window.AudioContext || window.webkitAudioContext;
  WEBAudio.audioContext = new AudioContext;
  WEBAudio.audioWebEnabled = 1;
 } catch (e) {
  alert("Web Audio API is not supported in this browser");
 }
}
function _emscripten_glFlush() {
 GLctx["flush"]();
}
function __ZN4FMOD13DSPConnection6setMixEf() {
 Module["printErr"]("missing function: _ZN4FMOD13DSPConnection6setMixEf");
 abort(-1);
}
function _emscripten_glCreateShader(shaderType) {
 var id = GL.getNewId(GL.shaders);
 GL.shaders[id] = GLctx.createShader(shaderType);
 return id;
}
function _pthread_cond_init() {
 return 0;
}
function _emscripten_glIsShader(shader) {
 var s = GL.shaders[shader];
 if (!s) return 0;
 return GLctx.isShader(s);
}
function _JS_WebRequest_GetResponseHeaders(request, buffer, bufferSize) {
 var headers = wr.requestInstances[request].getAllResponseHeaders();
 if (buffer) stringToUTF8(headers, buffer, bufferSize);
 return lengthBytesUTF8(headers);
}
function _glTexParameterf(x0, x1, x2) {
 GLctx["texParameterf"](x0, x1, x2);
}
function _JS_UNETWebSockets_SocketSend(hostId, ptr, length) {
 var socket = UNETWebSocketsInstances.hosts[hostId];
 if (socket == 0 || socket.socket.readyState != 1 || socket.state != UNETWebSocketsInstances.HostStates.Connected) return;
 socket.socket.send(HEAPU8.buffer.slice(ptr, ptr + length));
 socket.lastSentTime = Date.now();
}
function _glTexParameteri(x0, x1, x2) {
 GLctx["texParameteri"](x0, x1, x2);
}
function _emscripten_glColorMask(red, green, blue, alpha) {
 GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
}
function _emscripten_set_mousemove_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerMouseEventCallback(target, userData, useCapture, callbackfunc, 8, "mousemove");
 return 0;
}
function _emscripten_set_canvas_size(width, height) {
 Browser.setCanvasSize(width, height);
}
function _glPixelStorei(pname, param) {
 if (pname == 3333) {
  GL.packAlignment = param;
 } else if (pname == 3317) {
  GL.unpackAlignment = param;
 }
 GLctx.pixelStorei(pname, param);
}
function _glValidateProgram(program) {
 GLctx.validateProgram(GL.programs[program]);
}
function _JS_WebRequest_Abort(request) {
 wr.requestInstances[request].abort();
}
function ___syscall221(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), cmd = SYSCALLS.get();
  switch (cmd) {
  case 0:
   {
    var arg = SYSCALLS.get();
    if (arg < 0) {
     return -ERRNO_CODES.EINVAL;
    }
    var newStream;
    newStream = FS.open(stream.path, stream.flags, 0, arg);
    return newStream.fd;
   }
  case 1:
  case 2:
   return 0;
  case 3:
   return stream.flags;
  case 4:
   {
    var arg = SYSCALLS.get();
    stream.flags |= arg;
    return 0;
   }
  case 12:
  case 12:
   {
    var arg = SYSCALLS.get();
    var offset = 0;
    HEAP16[arg + offset >> 1] = 2;
    return 0;
   }
  case 13:
  case 14:
  case 13:
  case 14:
   return 0;
  case 16:
  case 8:
   return -ERRNO_CODES.EINVAL;
  case 9:
   ___setErrNo(ERRNO_CODES.EINVAL);
   return -1;
  default:
   {
    return -ERRNO_CODES.EINVAL;
   }
  }
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall220(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), dirp = SYSCALLS.get(), count = SYSCALLS.get();
  if (!stream.getdents) {
   stream.getdents = FS.readdir(stream.path);
  }
  var pos = 0;
  while (stream.getdents.length > 0 && pos + 268 <= count) {
   var id;
   var type;
   var name = stream.getdents.pop();
   assert(name.length < 256);
   if (name[0] === ".") {
    id = 1;
    type = 4;
   } else {
    var child = FS.lookupNode(stream.node, name);
    id = child.id;
    type = FS.isChrdev(child.mode) ? 2 : FS.isDir(child.mode) ? 4 : FS.isLink(child.mode) ? 10 : 8;
   }
   HEAP32[dirp + pos >> 2] = id;
   HEAP32[dirp + pos + 4 >> 2] = stream.position;
   HEAP16[dirp + pos + 8 >> 1] = 268;
   HEAP8[dirp + pos + 10 >> 0] = type;
   for (var i = 0; i < name.length; i++) {
    HEAP8[dirp + pos + (11 + i) >> 0] = name.charCodeAt(i);
   }
   HEAP8[dirp + pos + (11 + i) >> 0] = 0;
   pos += 268;
  }
  return pos;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _emscripten_glIsRenderbuffer(renderbuffer) {
 var rb = GL.renderbuffers[renderbuffer];
 if (!rb) return 0;
 return GLctx.isRenderbuffer(rb);
}
function _glLinkProgram(program) {
 GLctx.linkProgram(GL.programs[program]);
 GL.programInfos[program] = null;
 GL.populateUniformTable(program);
}
function _glBindTexture(target, texture) {
 GLctx.bindTexture(target, texture ? GL.textures[texture] : null);
}
function _glGetActiveUniformBlockName(program, uniformBlockIndex, bufSize, length, uniformBlockName) {
 program = GL.programs[program];
 var result = GLctx["getActiveUniformBlockName"](program, uniformBlockIndex);
 if (!result) return;
 if (uniformBlockName && bufSize > 0) {
  var numBytesWrittenExclNull = stringToUTF8(result, uniformBlockName, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
function _glUniform3iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 3;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform3iv(location, value);
}
function _emscripten_glShaderSource(shader, count, string, length) {
 var source = GL.getSource(shader, count, string, length);
 GLctx.shaderSource(GL.shaders[shader], source);
}
function _glEndQuery(x0) {
 GLctx["endQuery"](x0);
}
function _pthread_mutex_init() {}
function _emscripten_glIsTexture(texture) {
 var texture = GL.textures[texture];
 if (!texture) return 0;
 return GLctx.isTexture(texture);
}
function ___syscall54(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), op = SYSCALLS.get();
  switch (op) {
  case 21505:
   {
    if (!stream.tty) return -ERRNO_CODES.ENOTTY;
    return 0;
   }
  case 21506:
   {
    if (!stream.tty) return -ERRNO_CODES.ENOTTY;
    return 0;
   }
  case 21519:
   {
    if (!stream.tty) return -ERRNO_CODES.ENOTTY;
    var argp = SYSCALLS.get();
    HEAP32[argp >> 2] = 0;
    return 0;
   }
  case 21520:
   {
    if (!stream.tty) return -ERRNO_CODES.ENOTTY;
    return -ERRNO_CODES.EINVAL;
   }
  case 21531:
   {
    var argp = SYSCALLS.get();
    return FS.ioctl(stream, op, argp);
   }
  default:
   abort("bad ioctl syscall " + op);
  }
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glColorMask(red, green, blue, alpha) {
 GLctx.colorMask(!!red, !!green, !!blue, !!alpha);
}
function _glDeleteTextures(n, textures) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[textures + i * 4 >> 2];
  var texture = GL.textures[id];
  if (!texture) continue;
  GLctx.deleteTexture(texture);
  texture.name = 0;
  GL.textures[id] = null;
 }
}
function _glStencilOpSeparate(x0, x1, x2, x3) {
 GLctx["stencilOpSeparate"](x0, x1, x2, x3);
}
function _emscripten_glHint(x0, x1) {
 GLctx["hint"](x0, x1);
}
function _glDeleteQueries(n, ids) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[ids + i * 4 >> 2];
  var query = GL.queries[id];
  if (!query) continue;
  GLctx["deleteQuery"](query);
  GL.queries[id] = null;
 }
}
function _glVertexAttrib4f(x0, x1, x2, x3, x4) {
 GLctx["vertexAttrib4f"](x0, x1, x2, x3, x4);
}
function _emscripten_glUniform4i(location, v0, v1, v2, v3) {
 location = GL.uniforms[location];
 GLctx.uniform4i(location, v0, v1, v2, v3);
}
function _glGetTexParameteriv(target, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 HEAP32[params >> 2] = GLctx.getTexParameter(target, pname);
}
function _emscripten_glViewport(x0, x1, x2, x3) {
 GLctx["viewport"](x0, x1, x2, x3);
}
function _JS_UNETWebSockets_SocketCreate(hostId, url) {
 var str = Pointer_stringify(url);
 function keepAlive(socket) {
  var now = Date.now();
  var ab = new ArrayBuffer(1);
  var pData = new Uint8Array(ab);
  pData[0] = 255;
  if (now - socket.lastSentTime > socket.pingTimeout) {
   socket.socket.send(UNETWebSocketsInstances.pingDataArray);
   socket.lastSentTime = now;
  }
 }
 function cancelKeepAlive(socket) {
  if (socket.timerID) {
   clearTimeout(socket.timerID);
   socket.timerID = 0;
  }
 }
 var socket = {
  socket: new WebSocket(str, [ "unitygame" ]),
  buffer: new Uint8Array(0),
  error: null,
  id: hostId,
  state: UNETWebSocketsInstances.HostStates.Created,
  inQueue: false,
  timerID: 0,
  pingTimeout: 0,
  lastSentTime: Date.now(),
  messages: []
 };
 socket.socket.onopen = (function() {
  socket.state = UNETWebSocketsInstances.HostStates.Opening;
  _JS_UNETWebSockets_HostsContainingMessagesPush(socket);
  socket.timerID = setInterval((function() {
   keepAlive(socket);
  }), socket.pingTimeout);
 });
 socket.socket.onmessage = (function(e) {
  if (e.data instanceof Blob) {
   var reader = new FileReader;
   reader.addEventListener("loadend", (function() {
    var array = new Uint8Array(reader.result);
    _JS_UNETWebSockets_HostsContainingMessagesPush(socket);
    if (array.length == 1 && array[0] == 255) {
     return;
    }
    socket.messages.push(array);
   }));
   reader.readAsArrayBuffer(e.data);
  }
 });
 socket.socket.onclose = (function(e) {
  cancelKeepAlive(socket);
  if (socket.state == UNETWebSocketsInstances.HostStates.Closed) {
   return;
  }
  socket.state = UNETWebSocketsInstances.HostStates.Closing;
  _JS_UNETWebSockets_HostsContainingMessagesPush(socket);
 });
 socket.socket.onerror = (function(e) {
  console.log("Error: " + e.data + " socket will be closed");
  socket.state = UNETWebSocketsInstances.HostStates.Closing;
  _JS_UNETWebSockets_HostsContainingMessagesPush(socket);
 });
 socket.pingTimeout = UNETWebSocketsInstances.hosts[socket.id].pingTimeout;
 UNETWebSocketsInstances.hosts[socket.id] = socket;
}
function _emscripten_memcpy_big(dest, src, num) {
 HEAPU8.set(HEAPU8.subarray(src, src + num), dest);
 return dest;
}
Module["_memcpy"] = _memcpy;
var _llvm_pow_f64 = Math_pow;
function _glSamplerParameteri(sampler, pname, param) {
 GLctx["samplerParameteri"](sampler ? GL.samplers[sampler] : null, pname, param);
}
function _pthread_mutexattr_init() {}
var _llvm_fabs_f32 = Math_abs;
function _emscripten_glUniform3f(location, v0, v1, v2) {
 location = GL.uniforms[location];
 GLctx.uniform3f(location, v0, v1, v2);
}
function _emscripten_glBlendFunc(x0, x1) {
 GLctx["blendFunc"](x0, x1);
}
function _emscripten_glUniform3i(location, v0, v1, v2) {
 location = GL.uniforms[location];
 GLctx.uniform3i(location, v0, v1, v2);
}
function _emscripten_glStencilOp(x0, x1, x2) {
 GLctx["stencilOp"](x0, x1, x2);
}
function _glUniform1i(location, v0) {
 location = GL.uniforms[location];
 GLctx.uniform1i(location, v0);
}
function _glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
 program = GL.programs[program];
 var info = GLctx.getActiveAttrib(program, index);
 if (!info) return;
 if (bufSize > 0 && name) {
  var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
 if (size) HEAP32[size >> 2] = info.size;
 if (type) HEAP32[type >> 2] = info.type;
}
function _glTexSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixels) {
 var pixelData = null;
 if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, 0);
 GLctx.texSubImage2D(target, level, xoffset, yoffset, width, height, format, type, pixelData);
}
function emscriptenWebGLGetUniform(program, location, params, type) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 var data = GLctx.getUniform(GL.programs[program], GL.uniforms[location]);
 if (typeof data == "number" || typeof data == "boolean") {
  switch (type) {
  case "Integer":
   HEAP32[params >> 2] = data;
   break;
  case "Float":
   HEAPF32[params >> 2] = data;
   break;
  default:
   throw "internal emscriptenWebGLGetUniform() error, bad type: " + type;
  }
 } else {
  for (var i = 0; i < data.length; i++) {
   switch (type) {
   case "Integer":
    HEAP32[params + i >> 2] = data[i];
    break;
   case "Float":
    HEAPF32[params + i >> 2] = data[i];
    break;
   default:
    throw "internal emscriptenWebGLGetUniform() error, bad type: " + type;
   }
  }
 }
}
function _glGetUniformiv(program, location, params) {
 emscriptenWebGLGetUniform(program, location, params, "Integer");
}
function _emscripten_glEnableVertexAttribArray(index) {
 GLctx.enableVertexAttribArray(index);
}
function _JS_SystemInfo_GetMemory() {
 return TOTAL_MEMORY / (1024 * 1024);
}
function _atexit(func, arg) {
 __ATEXIT__.unshift({
  func: func,
  arg: arg
 });
}
function _emscripten_glCopyTexSubImage2D(x0, x1, x2, x3, x4, x5, x6, x7) {
 GLctx["copyTexSubImage2D"](x0, x1, x2, x3, x4, x5, x6, x7);
}
function _emscripten_set_touchcancel_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 25, "touchcancel");
 return 0;
}
function _glBindFramebuffer(target, framebuffer) {
 GLctx.bindFramebuffer(target, framebuffer ? GL.framebuffers[framebuffer] : null);
}
function _emscripten_glBlendFuncSeparate(x0, x1, x2, x3) {
 GLctx["blendFuncSeparate"](x0, x1, x2, x3);
}
function _glCullFace(x0) {
 GLctx["cullFace"](x0);
}
function _emscripten_glColorPointer() {
 Module["printErr"]("missing function: emscripten_glColorPointer");
 abort(-1);
}
function _emscripten_glNormalPointer() {
 Module["printErr"]("missing function: emscripten_glNormalPointer");
 abort(-1);
}
function _emscripten_webgl_make_context_current(contextHandle) {
 var success = GL.makeContextCurrent(contextHandle);
 return success ? 0 : -5;
}
function _emscripten_glGetFramebufferAttachmentParameteriv(target, attachment, pname, params) {
 var result = GLctx.getFramebufferAttachmentParameter(target, attachment, pname);
 HEAP32[params >> 2] = result;
}
function _emscripten_get_pointerlock_status(pointerlockStatus) {
 if (pointerlockStatus) JSEvents.fillPointerlockChangeEventData(pointerlockStatus);
 if (!document.body.requestPointerLock && !document.body.mozRequestPointerLock && !document.body.webkitRequestPointerLock && !document.body.msRequestPointerLock) {
  return -1;
 }
 return 0;
}
function _glAttachShader(program, shader) {
 GLctx.attachShader(GL.programs[program], GL.shaders[shader]);
}
function _emscripten_glGetVertexAttribfv(index, pname, params) {
 emscriptenWebGLGetVertexAttrib(index, pname, params, "Float");
}
function _emscripten_set_keyup_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 3, "keyup");
 return 0;
}
function _JS_Profiler_InjectJobs() {
 for (var jobname in Module["Jobs"]) {
  var job = Module["Jobs"][jobname];
  if (typeof job["endtime"] != "undefined") Module.ccall("InjectProfilerSample", null, [ "string", "number", "number" ], [ jobname, job.starttime, job.endtime ]);
 }
}
function _glDrawElements(mode, count, type, indices) {
 GLctx.drawElements(mode, count, type, indices);
}
Module["_i64Add"] = _i64Add;
Module["_i64Subtract"] = _i64Subtract;
var cttz_i8 = allocate([ 8, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 7, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 6, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 5, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0, 4, 0, 1, 0, 2, 0, 1, 0, 3, 0, 1, 0, 2, 0, 1, 0 ], "i8", ALLOC_STATIC);
Module["_llvm_cttz_i32"] = _llvm_cttz_i32;
Module["___udivmoddi4"] = ___udivmoddi4;
Module["___remdi3"] = ___remdi3;
function _emscripten_get_fullscreen_status(fullscreenStatus) {
 if (typeof JSEvents.fullscreenEnabled() === "undefined") return -1;
 JSEvents.fillFullscreenChangeEventData(fullscreenStatus);
 return 0;
}
function _malloc(bytes) {
 var ptr = Runtime.dynamicAlloc(bytes + 8);
 return ptr + 8 & 4294967288;
}
Module["_malloc"] = _malloc;
function _getenv(name) {
 if (name === 0) return 0;
 name = Pointer_stringify(name);
 if (!ENV.hasOwnProperty(name)) return 0;
 if (_getenv.ret) _free(_getenv.ret);
 _getenv.ret = allocate(intArrayFromString(ENV[name]), "i8", ALLOC_NORMAL);
 return _getenv.ret;
}
function _putenv(string) {
 if (string === 0) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 string = Pointer_stringify(string);
 var splitPoint = string.indexOf("=");
 if (string === "" || string.indexOf("=") === -1) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 var name = string.slice(0, splitPoint);
 var value = string.slice(splitPoint + 1);
 if (!(name in ENV) || ENV[name] !== value) {
  ENV[name] = value;
  ___buildEnvironment(ENV);
 }
 return 0;
}
function _SDL_RWFromConstMem(mem, size) {
 var id = SDL.rwops.length;
 SDL.rwops.push({
  bytes: mem,
  count: size
 });
 return id;
}
function _TTF_FontHeight(font) {
 var fontData = SDL.fonts[font];
 return fontData.size;
}
function _TTF_SizeText(font, text, w, h) {
 var fontData = SDL.fonts[font];
 if (w) {
  HEAP32[w >> 2] = SDL.estimateTextWidth(fontData, Pointer_stringify(text));
 }
 if (h) {
  HEAP32[h >> 2] = fontData.size;
 }
 return 0;
}
function _TTF_RenderText_Solid(font, text, color) {
 text = Pointer_stringify(text) || " ";
 var fontData = SDL.fonts[font];
 var w = SDL.estimateTextWidth(fontData, text);
 var h = fontData.size;
 var color = SDL.loadColorToCSSRGB(color);
 var fontString = h + "px " + fontData.name;
 var surf = SDL.makeSurface(w, h, 0, false, "text:" + text);
 var surfData = SDL.surfaces[surf];
 surfData.ctx.save();
 surfData.ctx.fillStyle = color;
 surfData.ctx.font = fontString;
 surfData.ctx.textBaseline = "top";
 surfData.ctx.fillText(text, 0, 0);
 surfData.ctx.restore();
 return surf;
}
function _Mix_HaltMusic() {
 var audio = SDL.music.audio;
 if (audio) {
  audio.src = audio.src;
  audio.currentPosition = 0;
  audio.pause();
 }
 SDL.music.audio = null;
 if (SDL.hookMusicFinished) {
  Module["dynCall_v"](SDL.hookMusicFinished);
 }
 return 0;
}
function _Mix_PlayMusic(id, loops) {
 if (SDL.music.audio) {
  if (!SDL.music.audio.paused) Module.printErr("Music is already playing. " + SDL.music.source);
  SDL.music.audio.pause();
 }
 var info = SDL.audios[id];
 var audio;
 if (info.webAudio) {
  audio = {};
  audio.resource = info;
  audio.paused = false;
  audio.currentPosition = 0;
  audio.play = (function() {
   SDL.playWebAudio(this);
  });
  audio.pause = (function() {
   SDL.pauseWebAudio(this);
  });
 } else if (info.audio) {
  audio = info.audio;
 }
 audio["onended"] = (function() {
  if (SDL.music.audio == this) _Mix_HaltMusic();
 });
 audio.loop = loops != 0;
 audio.volume = SDL.music.volume;
 SDL.music.audio = audio;
 audio.play();
 return 0;
}
function _Mix_FreeChunk(id) {
 SDL.audios[id] = null;
}
function _Mix_LoadWAV_RW(rwopsID, freesrc) {
 var rwops = SDL.rwops[rwopsID];
 if (rwops === undefined) return 0;
 var filename = "";
 var audio;
 var webAudio;
 var bytes;
 if (rwops.filename !== undefined) {
  filename = PATH.resolve(rwops.filename);
  var raw = Module["preloadedAudios"][filename];
  if (!raw) {
   if (raw === null) Module.printErr("Trying to reuse preloaded audio, but freePreloadedMediaOnUse is set!");
   if (!Module.noAudioDecoding) Runtime.warnOnce("Cannot find preloaded audio " + filename);
   try {
    bytes = FS.readFile(filename);
   } catch (e) {
    Module.printErr("Couldn't find file for: " + filename);
    return 0;
   }
  }
  if (Module["freePreloadedMediaOnUse"]) {
   Module["preloadedAudios"][filename] = null;
  }
  audio = raw;
 } else if (rwops.bytes !== undefined) {
  if (SDL.webAudioAvailable()) bytes = HEAPU8.buffer.slice(rwops.bytes, rwops.bytes + rwops.count); else bytes = HEAPU8.subarray(rwops.bytes, rwops.bytes + rwops.count);
 } else {
  return 0;
 }
 var arrayBuffer = bytes ? bytes.buffer || bytes : bytes;
 var canPlayWithWebAudio = Module["SDL_canPlayWithWebAudio"] === undefined || Module["SDL_canPlayWithWebAudio"](filename, arrayBuffer);
 if (bytes !== undefined && SDL.webAudioAvailable() && canPlayWithWebAudio) {
  audio = undefined;
  webAudio = {};
  webAudio.onDecodeComplete = [];
  function onDecodeComplete(data) {
   webAudio.decodedBuffer = data;
   webAudio.onDecodeComplete.forEach((function(e) {
    e();
   }));
   webAudio.onDecodeComplete = undefined;
  }
  SDL.audioContext["decodeAudioData"](arrayBuffer, onDecodeComplete);
 } else if (audio === undefined && bytes) {
  var blob = new Blob([ bytes ], {
   type: rwops.mimetype
  });
  var url = URL.createObjectURL(blob);
  audio = new Audio;
  audio.src = url;
  audio.mozAudioChannelType = "content";
 }
 var id = SDL.audios.length;
 SDL.audios.push({
  source: filename,
  audio: audio,
  webAudio: webAudio
 });
 return id;
}
function _Mix_PlayChannel(channel, id, loops) {
 var info = SDL.audios[id];
 if (!info) return -1;
 if (!info.audio && !info.webAudio) return -1;
 if (channel == -1) {
  for (var i = SDL.channelMinimumNumber; i < SDL.numChannels; i++) {
   if (!SDL.channels[i].audio) {
    channel = i;
    break;
   }
  }
  if (channel == -1) {
   Module.printErr("All " + SDL.numChannels + " channels in use!");
   return -1;
  }
 }
 var channelInfo = SDL.channels[channel];
 var audio;
 if (info.webAudio) {
  audio = {};
  audio.resource = info;
  audio.paused = false;
  audio.currentPosition = 0;
  audio.play = (function() {
   SDL.playWebAudio(this);
  });
  audio.pause = (function() {
   SDL.pauseWebAudio(this);
  });
 } else {
  audio = info.audio.cloneNode(true);
  audio.numChannels = info.audio.numChannels;
  audio.frequency = info.audio.frequency;
 }
 audio["onended"] = function SDL_audio_onended() {
  if (channelInfo.audio == this) {
   channelInfo.audio.paused = true;
   channelInfo.audio = null;
  }
  if (SDL.channelFinished) Runtime.getFuncWrapper(SDL.channelFinished, "vi")(channel);
 };
 channelInfo.audio = audio;
 audio.loop = loops != 0;
 audio.volume = channelInfo.volume;
 audio.play();
 return channel;
}
function _SDL_PauseAudio(pauseOn) {
 if (!SDL.audio) {
  return;
 }
 if (pauseOn) {
  if (SDL.audio.timer !== undefined) {
   clearTimeout(SDL.audio.timer);
   SDL.audio.numAudioTimersPending = 0;
   SDL.audio.timer = undefined;
  }
 } else if (!SDL.audio.timer) {
  SDL.audio.numAudioTimersPending = 1;
  SDL.audio.timer = Browser.safeSetTimeout(SDL.audio.caller, 1);
 }
 SDL.audio.paused = pauseOn;
}
function _SDL_CloseAudio() {
 if (SDL.audio) {
  _SDL_PauseAudio(1);
  _free(SDL.audio.buffer);
  SDL.audio = null;
  SDL.allocateChannels(0);
 }
}
function _SDL_LockSurface(surf) {
 var surfData = SDL.surfaces[surf];
 surfData.locked++;
 if (surfData.locked > 1) return 0;
 if (!surfData.buffer) {
  surfData.buffer = _malloc(surfData.width * surfData.height * 4);
  HEAP32[surf + 20 >> 2] = surfData.buffer;
 }
 HEAP32[surf + 20 >> 2] = surfData.buffer;
 if (surf == SDL.screen && Module.screenIsReadOnly && surfData.image) return 0;
 if (SDL.defaults.discardOnLock) {
  if (!surfData.image) {
   surfData.image = surfData.ctx.createImageData(surfData.width, surfData.height);
  }
  if (!SDL.defaults.opaqueFrontBuffer) return;
 } else {
  surfData.image = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
 }
 if (surf == SDL.screen && SDL.defaults.opaqueFrontBuffer) {
  var data = surfData.image.data;
  var num = data.length;
  for (var i = 0; i < num / 4; i++) {
   data[i * 4 + 3] = 255;
  }
 }
 if (SDL.defaults.copyOnLock && !SDL.defaults.discardOnLock) {
  if (surfData.isFlagSet(2097152)) {
   throw "CopyOnLock is not supported for SDL_LockSurface with SDL_HWPALETTE flag set" + (new Error).stack;
  } else {
   HEAPU8.set(surfData.image.data, surfData.buffer);
  }
 }
 return 0;
}
function _SDL_FreeRW(rwopsID) {
 SDL.rwops[rwopsID] = null;
 while (SDL.rwops.length > 0 && SDL.rwops[SDL.rwops.length - 1] === null) {
  SDL.rwops.pop();
 }
}
function _IMG_Load_RW(rwopsID, freeSrc) {
 try {
  function cleanup() {
   if (rwops && freeSrc) _SDL_FreeRW(rwopsID);
  }
  function addCleanup(func) {
   var old = cleanup;
   cleanup = function added_cleanup() {
    old();
    func();
   };
  }
  var rwops = SDL.rwops[rwopsID];
  if (rwops === undefined) {
   return 0;
  }
  var filename = rwops.filename;
  if (filename === undefined) {
   Runtime.warnOnce("Only file names that have been preloaded are supported for IMG_Load_RW. Consider using STB_IMAGE=1 if you want synchronous image decoding (see settings.js), or package files with --use-preload-plugins");
   return 0;
  }
  if (!raw) {
   filename = PATH.resolve(filename);
   var raw = Module["preloadedImages"][filename];
   if (!raw) {
    if (raw === null) Module.printErr("Trying to reuse preloaded image, but freePreloadedMediaOnUse is set!");
    Runtime.warnOnce("Cannot find preloaded image " + filename);
    Runtime.warnOnce("Cannot find preloaded image " + filename + ". Consider using STB_IMAGE=1 if you want synchronous image decoding (see settings.js), or package files with --use-preload-plugins");
    return 0;
   } else if (Module["freePreloadedMediaOnUse"]) {
    Module["preloadedImages"][filename] = null;
   }
  }
  var surf = SDL.makeSurface(raw.width, raw.height, 0, false, "load:" + filename);
  var surfData = SDL.surfaces[surf];
  surfData.ctx.globalCompositeOperation = "copy";
  if (!raw.rawData) {
   surfData.ctx.drawImage(raw, 0, 0, raw.width, raw.height, 0, 0, raw.width, raw.height);
  } else {
   var imageData = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
   if (raw.bpp == 4) {
    imageData.data.set(HEAPU8.subarray(raw.data, raw.data + raw.size));
   } else if (raw.bpp == 3) {
    var pixels = raw.size / 3;
    var data = imageData.data;
    var sourcePtr = raw.data;
    var destPtr = 0;
    for (var i = 0; i < pixels; i++) {
     data[destPtr++] = HEAPU8[sourcePtr++ >> 0];
     data[destPtr++] = HEAPU8[sourcePtr++ >> 0];
     data[destPtr++] = HEAPU8[sourcePtr++ >> 0];
     data[destPtr++] = 255;
    }
   } else if (raw.bpp == 1) {
    var pixels = raw.size;
    var data = imageData.data;
    var sourcePtr = raw.data;
    var destPtr = 0;
    for (var i = 0; i < pixels; i++) {
     var value = HEAPU8[sourcePtr++ >> 0];
     data[destPtr++] = value;
     data[destPtr++] = value;
     data[destPtr++] = value;
     data[destPtr++] = 255;
    }
   } else {
    Module.printErr("cannot handle bpp " + raw.bpp);
    return 0;
   }
   surfData.ctx.putImageData(imageData, 0, 0);
  }
  surfData.ctx.globalCompositeOperation = "source-over";
  _SDL_LockSurface(surf);
  surfData.locked--;
  if (SDL.GL) {
   surfData.canvas = surfData.ctx = null;
  }
  return surf;
 } finally {
  cleanup();
 }
}
function _SDL_RWFromFile(_name, mode) {
 var id = SDL.rwops.length;
 var name = Pointer_stringify(_name);
 SDL.rwops.push({
  filename: name,
  mimetype: Browser.getMimetype(name)
 });
 return id;
}
function _IMG_Load(filename) {
 var rwops = _SDL_RWFromFile(filename);
 var result = _IMG_Load_RW(rwops, 1);
 return result;
}
function _SDL_UpperBlitScaled(src, srcrect, dst, dstrect) {
 return SDL.blitSurface(src, srcrect, dst, dstrect, true);
}
function _SDL_UpperBlit(src, srcrect, dst, dstrect) {
 return SDL.blitSurface(src, srcrect, dst, dstrect, false);
}
function _SDL_GetTicks() {
 return Date.now() - SDL.startTime | 0;
}
var SDL = {
 defaults: {
  width: 320,
  height: 200,
  copyOnLock: true,
  discardOnLock: false,
  opaqueFrontBuffer: true
 },
 version: null,
 surfaces: {},
 canvasPool: [],
 events: [],
 fonts: [ null ],
 audios: [ null ],
 rwops: [ null ],
 music: {
  audio: null,
  volume: 1
 },
 mixerFrequency: 22050,
 mixerFormat: 32784,
 mixerNumChannels: 2,
 mixerChunkSize: 1024,
 channelMinimumNumber: 0,
 GL: false,
 glAttributes: {
  0: 3,
  1: 3,
  2: 2,
  3: 0,
  4: 0,
  5: 1,
  6: 16,
  7: 0,
  8: 0,
  9: 0,
  10: 0,
  11: 0,
  12: 0,
  13: 0,
  14: 0,
  15: 1,
  16: 0,
  17: 0,
  18: 0
 },
 keyboardState: null,
 keyboardMap: {},
 canRequestFullscreen: false,
 isRequestingFullscreen: false,
 textInput: false,
 startTime: null,
 initFlags: 0,
 buttonState: 0,
 modState: 0,
 DOMButtons: [ 0, 0, 0 ],
 DOMEventToSDLEvent: {},
 TOUCH_DEFAULT_ID: 0,
 eventHandler: null,
 eventHandlerContext: null,
 eventHandlerTemp: 0,
 keyCodes: {
  16: 1249,
  17: 1248,
  18: 1250,
  20: 1081,
  33: 1099,
  34: 1102,
  35: 1101,
  36: 1098,
  37: 1104,
  38: 1106,
  39: 1103,
  40: 1105,
  44: 316,
  45: 1097,
  46: 127,
  91: 1251,
  93: 1125,
  96: 1122,
  97: 1113,
  98: 1114,
  99: 1115,
  100: 1116,
  101: 1117,
  102: 1118,
  103: 1119,
  104: 1120,
  105: 1121,
  106: 1109,
  107: 1111,
  109: 1110,
  110: 1123,
  111: 1108,
  112: 1082,
  113: 1083,
  114: 1084,
  115: 1085,
  116: 1086,
  117: 1087,
  118: 1088,
  119: 1089,
  120: 1090,
  121: 1091,
  122: 1092,
  123: 1093,
  124: 1128,
  125: 1129,
  126: 1130,
  127: 1131,
  128: 1132,
  129: 1133,
  130: 1134,
  131: 1135,
  132: 1136,
  133: 1137,
  134: 1138,
  135: 1139,
  144: 1107,
  160: 94,
  161: 33,
  162: 34,
  163: 35,
  164: 36,
  165: 37,
  166: 38,
  167: 95,
  168: 40,
  169: 41,
  170: 42,
  171: 43,
  172: 124,
  173: 45,
  174: 123,
  175: 125,
  176: 126,
  181: 127,
  182: 129,
  183: 128,
  188: 44,
  190: 46,
  191: 47,
  192: 96,
  219: 91,
  220: 92,
  221: 93,
  222: 39,
  224: 1251
 },
 scanCodes: {
  8: 42,
  9: 43,
  13: 40,
  27: 41,
  32: 44,
  35: 204,
  39: 53,
  44: 54,
  46: 55,
  47: 56,
  48: 39,
  49: 30,
  50: 31,
  51: 32,
  52: 33,
  53: 34,
  54: 35,
  55: 36,
  56: 37,
  57: 38,
  58: 203,
  59: 51,
  61: 46,
  91: 47,
  92: 49,
  93: 48,
  96: 52,
  97: 4,
  98: 5,
  99: 6,
  100: 7,
  101: 8,
  102: 9,
  103: 10,
  104: 11,
  105: 12,
  106: 13,
  107: 14,
  108: 15,
  109: 16,
  110: 17,
  111: 18,
  112: 19,
  113: 20,
  114: 21,
  115: 22,
  116: 23,
  117: 24,
  118: 25,
  119: 26,
  120: 27,
  121: 28,
  122: 29,
  127: 76,
  305: 224,
  308: 226,
  316: 70
 },
 loadRect: (function(rect) {
  return {
   x: HEAP32[rect + 0 >> 2],
   y: HEAP32[rect + 4 >> 2],
   w: HEAP32[rect + 8 >> 2],
   h: HEAP32[rect + 12 >> 2]
  };
 }),
 updateRect: (function(rect, r) {
  HEAP32[rect >> 2] = r.x;
  HEAP32[rect + 4 >> 2] = r.y;
  HEAP32[rect + 8 >> 2] = r.w;
  HEAP32[rect + 12 >> 2] = r.h;
 }),
 intersectionOfRects: (function(first, second) {
  var leftX = Math.max(first.x, second.x);
  var leftY = Math.max(first.y, second.y);
  var rightX = Math.min(first.x + first.w, second.x + second.w);
  var rightY = Math.min(first.y + first.h, second.y + second.h);
  return {
   x: leftX,
   y: leftY,
   w: Math.max(leftX, rightX) - leftX,
   h: Math.max(leftY, rightY) - leftY
  };
 }),
 checkPixelFormat: (function(fmt) {
  var format = HEAP32[fmt >> 2];
  if (format != -2042224636) {
   Runtime.warnOnce("Unsupported pixel format!");
  }
 }),
 loadColorToCSSRGB: (function(color) {
  var rgba = HEAP32[color >> 2];
  return "rgb(" + (rgba & 255) + "," + (rgba >> 8 & 255) + "," + (rgba >> 16 & 255) + ")";
 }),
 loadColorToCSSRGBA: (function(color) {
  var rgba = HEAP32[color >> 2];
  return "rgba(" + (rgba & 255) + "," + (rgba >> 8 & 255) + "," + (rgba >> 16 & 255) + "," + (rgba >> 24 & 255) / 255 + ")";
 }),
 translateColorToCSSRGBA: (function(rgba) {
  return "rgba(" + (rgba & 255) + "," + (rgba >> 8 & 255) + "," + (rgba >> 16 & 255) + "," + (rgba >>> 24) / 255 + ")";
 }),
 translateRGBAToCSSRGBA: (function(r, g, b, a) {
  return "rgba(" + (r & 255) + "," + (g & 255) + "," + (b & 255) + "," + (a & 255) / 255 + ")";
 }),
 translateRGBAToColor: (function(r, g, b, a) {
  return r | g << 8 | b << 16 | a << 24;
 }),
 makeSurface: (function(width, height, flags, usePageCanvas, source, rmask, gmask, bmask, amask) {
  flags = flags || 0;
  var is_SDL_HWSURFACE = flags & 1;
  var is_SDL_HWPALETTE = flags & 2097152;
  var is_SDL_OPENGL = flags & 67108864;
  var surf = _malloc(60);
  var pixelFormat = _malloc(44);
  var bpp = is_SDL_HWPALETTE ? 1 : 4;
  var buffer = 0;
  if (!is_SDL_HWSURFACE && !is_SDL_OPENGL) {
   buffer = _malloc(width * height * 4);
  }
  HEAP32[surf >> 2] = flags;
  HEAP32[surf + 4 >> 2] = pixelFormat;
  HEAP32[surf + 8 >> 2] = width;
  HEAP32[surf + 12 >> 2] = height;
  HEAP32[surf + 16 >> 2] = width * bpp;
  HEAP32[surf + 20 >> 2] = buffer;
  HEAP32[surf + 36 >> 2] = 0;
  HEAP32[surf + 40 >> 2] = 0;
  HEAP32[surf + 44 >> 2] = Module["canvas"].width;
  HEAP32[surf + 48 >> 2] = Module["canvas"].height;
  HEAP32[surf + 56 >> 2] = 1;
  HEAP32[pixelFormat >> 2] = -2042224636;
  HEAP32[pixelFormat + 4 >> 2] = 0;
  HEAP8[pixelFormat + 8 >> 0] = bpp * 8;
  HEAP8[pixelFormat + 9 >> 0] = bpp;
  HEAP32[pixelFormat + 12 >> 2] = rmask || 255;
  HEAP32[pixelFormat + 16 >> 2] = gmask || 65280;
  HEAP32[pixelFormat + 20 >> 2] = bmask || 16711680;
  HEAP32[pixelFormat + 24 >> 2] = amask || 4278190080;
  SDL.GL = SDL.GL || is_SDL_OPENGL;
  var canvas;
  if (!usePageCanvas) {
   if (SDL.canvasPool.length > 0) {
    canvas = SDL.canvasPool.pop();
   } else {
    canvas = document.createElement("canvas");
   }
   canvas.width = width;
   canvas.height = height;
  } else {
   canvas = Module["canvas"];
  }
  var webGLContextAttributes = {
   antialias: SDL.glAttributes[13] != 0 && SDL.glAttributes[14] > 1,
   depth: SDL.glAttributes[6] > 0,
   stencil: SDL.glAttributes[7] > 0,
   alpha: SDL.glAttributes[3] > 0
  };
  var ctx = Browser.createContext(canvas, is_SDL_OPENGL, usePageCanvas, webGLContextAttributes);
  SDL.surfaces[surf] = {
   width: width,
   height: height,
   canvas: canvas,
   ctx: ctx,
   surf: surf,
   buffer: buffer,
   pixelFormat: pixelFormat,
   alpha: 255,
   flags: flags,
   locked: 0,
   usePageCanvas: usePageCanvas,
   source: source,
   isFlagSet: (function(flag) {
    return flags & flag;
   })
  };
  return surf;
 }),
 copyIndexedColorData: (function(surfData, rX, rY, rW, rH) {
  if (!surfData.colors) {
   return;
  }
  var fullWidth = Module["canvas"].width;
  var fullHeight = Module["canvas"].height;
  var startX = rX || 0;
  var startY = rY || 0;
  var endX = (rW || fullWidth - startX) + startX;
  var endY = (rH || fullHeight - startY) + startY;
  var buffer = surfData.buffer;
  if (!surfData.image.data32) {
   surfData.image.data32 = new Uint32Array(surfData.image.data.buffer);
  }
  var data32 = surfData.image.data32;
  var colors32 = surfData.colors32;
  for (var y = startY; y < endY; ++y) {
   var base = y * fullWidth;
   for (var x = startX; x < endX; ++x) {
    data32[base + x] = colors32[HEAPU8[buffer + base + x >> 0]];
   }
  }
 }),
 freeSurface: (function(surf) {
  var refcountPointer = surf + 56;
  var refcount = HEAP32[refcountPointer >> 2];
  if (refcount > 1) {
   HEAP32[refcountPointer >> 2] = refcount - 1;
   return;
  }
  var info = SDL.surfaces[surf];
  if (!info.usePageCanvas && info.canvas) SDL.canvasPool.push(info.canvas);
  if (info.buffer) _free(info.buffer);
  _free(info.pixelFormat);
  _free(surf);
  SDL.surfaces[surf] = null;
  if (surf === SDL.screen) {
   SDL.screen = null;
  }
 }),
 blitSurface__deps: [ "SDL_LockSurface" ],
 blitSurface: (function(src, srcrect, dst, dstrect, scale) {
  var srcData = SDL.surfaces[src];
  var dstData = SDL.surfaces[dst];
  var sr, dr;
  if (srcrect) {
   sr = SDL.loadRect(srcrect);
  } else {
   sr = {
    x: 0,
    y: 0,
    w: srcData.width,
    h: srcData.height
   };
  }
  if (dstrect) {
   dr = SDL.loadRect(dstrect);
  } else {
   dr = {
    x: 0,
    y: 0,
    w: srcData.width,
    h: srcData.height
   };
  }
  if (dstData.clipRect) {
   var widthScale = !scale || sr.w === 0 ? 1 : sr.w / dr.w;
   var heightScale = !scale || sr.h === 0 ? 1 : sr.h / dr.h;
   dr = SDL.intersectionOfRects(dstData.clipRect, dr);
   sr.w = dr.w * widthScale;
   sr.h = dr.h * heightScale;
   if (dstrect) {
    SDL.updateRect(dstrect, dr);
   }
  }
  var blitw, blith;
  if (scale) {
   blitw = dr.w;
   blith = dr.h;
  } else {
   blitw = sr.w;
   blith = sr.h;
  }
  if (sr.w === 0 || sr.h === 0 || blitw === 0 || blith === 0) {
   return 0;
  }
  var oldAlpha = dstData.ctx.globalAlpha;
  dstData.ctx.globalAlpha = srcData.alpha / 255;
  dstData.ctx.drawImage(srcData.canvas, sr.x, sr.y, sr.w, sr.h, dr.x, dr.y, blitw, blith);
  dstData.ctx.globalAlpha = oldAlpha;
  if (dst != SDL.screen) {
   Runtime.warnOnce("WARNING: copying canvas data to memory for compatibility");
   _SDL_LockSurface(dst);
   dstData.locked--;
  }
  return 0;
 }),
 downFingers: {},
 savedKeydown: null,
 receiveEvent: (function(event) {
  function unpressAllPressedKeys() {
   for (var code in SDL.keyboardMap) {
    SDL.events.push({
     type: "keyup",
     keyCode: SDL.keyboardMap[code]
    });
   }
  }
  switch (event.type) {
  case "touchstart":
  case "touchmove":
   {
    event.preventDefault();
    var touches = [];
    if (event.type === "touchstart") {
     for (var i = 0; i < event.touches.length; i++) {
      var touch = event.touches[i];
      if (SDL.downFingers[touch.identifier] != true) {
       SDL.downFingers[touch.identifier] = true;
       touches.push(touch);
      }
     }
    } else {
     touches = event.touches;
    }
    var firstTouch = touches[0];
    if (event.type == "touchstart") {
     SDL.DOMButtons[0] = 1;
    }
    var mouseEventType;
    switch (event.type) {
    case "touchstart":
     mouseEventType = "mousedown";
     break;
    case "touchmove":
     mouseEventType = "mousemove";
     break;
    }
    var mouseEvent = {
     type: mouseEventType,
     button: 0,
     pageX: firstTouch.clientX,
     pageY: firstTouch.clientY
    };
    SDL.events.push(mouseEvent);
    for (var i = 0; i < touches.length; i++) {
     var touch = touches[i];
     SDL.events.push({
      type: event.type,
      touch: touch
     });
    }
    break;
   }
  case "touchend":
   {
    event.preventDefault();
    for (var i = 0; i < event.changedTouches.length; i++) {
     var touch = event.changedTouches[i];
     if (SDL.downFingers[touch.identifier] === true) {
      delete SDL.downFingers[touch.identifier];
     }
    }
    var mouseEvent = {
     type: "mouseup",
     button: 0,
     pageX: event.changedTouches[0].clientX,
     pageY: event.changedTouches[0].clientY
    };
    SDL.DOMButtons[0] = 0;
    SDL.events.push(mouseEvent);
    for (var i = 0; i < event.changedTouches.length; i++) {
     var touch = event.changedTouches[i];
     SDL.events.push({
      type: "touchend",
      touch: touch
     });
    }
    break;
   }
  case "DOMMouseScroll":
  case "mousewheel":
  case "wheel":
   var delta = -Browser.getMouseWheelDelta(event);
   delta = delta == 0 ? 0 : delta > 0 ? Math.max(delta, 1) : Math.min(delta, -1);
   var button = delta > 0 ? 3 : 4;
   SDL.events.push({
    type: "mousedown",
    button: button,
    pageX: event.pageX,
    pageY: event.pageY
   });
   SDL.events.push({
    type: "mouseup",
    button: button,
    pageX: event.pageX,
    pageY: event.pageY
   });
   SDL.events.push({
    type: "wheel",
    deltaX: 0,
    deltaY: delta
   });
   event.preventDefault();
   break;
  case "mousemove":
   if (SDL.DOMButtons[0] === 1) {
    SDL.events.push({
     type: "touchmove",
     touch: {
      identifier: 0,
      deviceID: -1,
      pageX: event.pageX,
      pageY: event.pageY
     }
    });
   }
   if (Browser.pointerLock) {
    if ("mozMovementX" in event) {
     event["movementX"] = event["mozMovementX"];
     event["movementY"] = event["mozMovementY"];
    }
    if (event["movementX"] == 0 && event["movementY"] == 0) {
     event.preventDefault();
     return;
    }
   }
  case "keydown":
  case "keyup":
  case "keypress":
  case "mousedown":
  case "mouseup":
   if (event.type !== "keydown" || !SDL.unicode && !SDL.textInput || event.keyCode === 8 || event.keyCode === 9) {
    event.preventDefault();
   }
   if (event.type == "mousedown") {
    SDL.DOMButtons[event.button] = 1;
    SDL.events.push({
     type: "touchstart",
     touch: {
      identifier: 0,
      deviceID: -1,
      pageX: event.pageX,
      pageY: event.pageY
     }
    });
   } else if (event.type == "mouseup") {
    if (!SDL.DOMButtons[event.button]) {
     return;
    }
    SDL.events.push({
     type: "touchend",
     touch: {
      identifier: 0,
      deviceID: -1,
      pageX: event.pageX,
      pageY: event.pageY
     }
    });
    SDL.DOMButtons[event.button] = 0;
   }
   if (event.type === "keydown" || event.type === "mousedown") {
    SDL.canRequestFullscreen = true;
   } else if (event.type === "keyup" || event.type === "mouseup") {
    if (SDL.isRequestingFullscreen) {
     Module["requestFullscreen"](true, true);
     SDL.isRequestingFullscreen = false;
    }
    SDL.canRequestFullscreen = false;
   }
   if (event.type === "keypress" && SDL.savedKeydown) {
    SDL.savedKeydown.keypressCharCode = event.charCode;
    SDL.savedKeydown = null;
   } else if (event.type === "keydown") {
    SDL.savedKeydown = event;
   }
   if (event.type !== "keypress" || SDL.textInput) {
    SDL.events.push(event);
   }
   break;
  case "mouseout":
   for (var i = 0; i < 3; i++) {
    if (SDL.DOMButtons[i]) {
     SDL.events.push({
      type: "mouseup",
      button: i,
      pageX: event.pageX,
      pageY: event.pageY
     });
     SDL.DOMButtons[i] = 0;
    }
   }
   event.preventDefault();
   break;
  case "focus":
   SDL.events.push(event);
   event.preventDefault();
   break;
  case "blur":
   SDL.events.push(event);
   unpressAllPressedKeys();
   event.preventDefault();
   break;
  case "visibilitychange":
   SDL.events.push({
    type: "visibilitychange",
    visible: !document.hidden
   });
   unpressAllPressedKeys();
   event.preventDefault();
   break;
  case "unload":
   if (Browser.mainLoop.runner) {
    SDL.events.push(event);
    Browser.mainLoop.runner();
   }
   return;
  case "resize":
   SDL.events.push(event);
   if (event.preventDefault) {
    event.preventDefault();
   }
   break;
  }
  if (SDL.events.length >= 1e4) {
   Module.printErr("SDL event queue full, dropping events");
   SDL.events = SDL.events.slice(0, 1e4);
  }
  SDL.flushEventsToHandler();
  return;
 }),
 lookupKeyCodeForEvent: (function(event) {
  var code = event.keyCode;
  if (code >= 65 && code <= 90) {
   code += 32;
  } else {
   code = SDL.keyCodes[event.keyCode] || event.keyCode;
   if (event.location === KeyboardEvent.DOM_KEY_LOCATION_RIGHT && code >= (224 | 1 << 10) && code <= (227 | 1 << 10)) {
    code += 4;
   }
  }
  return code;
 }),
 handleEvent: (function(event) {
  if (event.handled) return;
  event.handled = true;
  switch (event.type) {
  case "touchstart":
  case "touchend":
  case "touchmove":
   {
    Browser.calculateMouseEvent(event);
    break;
   }
  case "keydown":
  case "keyup":
   {
    var down = event.type === "keydown";
    var code = SDL.lookupKeyCodeForEvent(event);
    HEAP8[SDL.keyboardState + code >> 0] = down;
    SDL.modState = (HEAP8[SDL.keyboardState + 1248 >> 0] ? 64 : 0) | (HEAP8[SDL.keyboardState + 1249 >> 0] ? 1 : 0) | (HEAP8[SDL.keyboardState + 1250 >> 0] ? 256 : 0) | (HEAP8[SDL.keyboardState + 1252 >> 0] ? 128 : 0) | (HEAP8[SDL.keyboardState + 1253 >> 0] ? 2 : 0) | (HEAP8[SDL.keyboardState + 1254 >> 0] ? 512 : 0);
    if (down) {
     SDL.keyboardMap[code] = event.keyCode;
    } else {
     delete SDL.keyboardMap[code];
    }
    break;
   }
  case "mousedown":
  case "mouseup":
   if (event.type == "mousedown") {
    SDL.buttonState |= 1 << event.button;
   } else if (event.type == "mouseup") {
    SDL.buttonState &= ~(1 << event.button);
   }
  case "mousemove":
   {
    Browser.calculateMouseEvent(event);
    break;
   }
  }
 }),
 flushEventsToHandler: (function() {
  if (!SDL.eventHandler) return;
  while (SDL.pollEvent(SDL.eventHandlerTemp)) {
   Module["dynCall_iii"](SDL.eventHandler, SDL.eventHandlerContext, SDL.eventHandlerTemp);
  }
 }),
 pollEvent: (function(ptr) {
  if (SDL.initFlags & 512 && SDL.joystickEventState) {
   SDL.queryJoysticks();
  }
  if (ptr) {
   while (SDL.events.length > 0) {
    if (SDL.makeCEvent(SDL.events.shift(), ptr) !== false) return 1;
   }
   return 0;
  } else {
   return SDL.events.length > 0;
  }
 }),
 makeCEvent: (function(event, ptr) {
  if (typeof event === "number") {
   _memcpy(ptr, event, 28);
   _free(event);
   return;
  }
  SDL.handleEvent(event);
  switch (event.type) {
  case "keydown":
  case "keyup":
   {
    var down = event.type === "keydown";
    var key = SDL.lookupKeyCodeForEvent(event);
    var scan;
    if (key >= 1024) {
     scan = key - 1024;
    } else {
     scan = SDL.scanCodes[key] || key;
    }
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP8[ptr + 8 >> 0] = down ? 1 : 0;
    HEAP8[ptr + 9 >> 0] = 0;
    HEAP32[ptr + 12 >> 2] = scan;
    HEAP32[ptr + 16 >> 2] = key;
    HEAP16[ptr + 20 >> 1] = SDL.modState;
    HEAP32[ptr + 24 >> 2] = event.keypressCharCode || key;
    break;
   }
  case "keypress":
   {
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    var cStr = intArrayFromString(String.fromCharCode(event.charCode));
    for (var i = 0; i < cStr.length; ++i) {
     HEAP8[ptr + (8 + i) >> 0] = cStr[i];
    }
    break;
   }
  case "mousedown":
  case "mouseup":
  case "mousemove":
   {
    if (event.type != "mousemove") {
     var down = event.type === "mousedown";
     HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
     HEAP32[ptr + 4 >> 2] = 0;
     HEAP32[ptr + 8 >> 2] = 0;
     HEAP32[ptr + 12 >> 2] = 0;
     HEAP8[ptr + 16 >> 0] = event.button + 1;
     HEAP8[ptr + 17 >> 0] = down ? 1 : 0;
     HEAP32[ptr + 20 >> 2] = Browser.mouseX;
     HEAP32[ptr + 24 >> 2] = Browser.mouseY;
    } else {
     HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
     HEAP32[ptr + 4 >> 2] = 0;
     HEAP32[ptr + 8 >> 2] = 0;
     HEAP32[ptr + 12 >> 2] = 0;
     HEAP32[ptr + 16 >> 2] = SDL.buttonState;
     HEAP32[ptr + 20 >> 2] = Browser.mouseX;
     HEAP32[ptr + 24 >> 2] = Browser.mouseY;
     HEAP32[ptr + 28 >> 2] = Browser.mouseMovementX;
     HEAP32[ptr + 32 >> 2] = Browser.mouseMovementY;
    }
    break;
   }
  case "wheel":
   {
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 16 >> 2] = event.deltaX;
    HEAP32[ptr + 20 >> 2] = event.deltaY;
    break;
   }
  case "touchstart":
  case "touchend":
  case "touchmove":
   {
    var touch = event.touch;
    if (!Browser.touches[touch.identifier]) break;
    var w = Module["canvas"].width;
    var h = Module["canvas"].height;
    var x = Browser.touches[touch.identifier].x / w;
    var y = Browser.touches[touch.identifier].y / h;
    var lx = Browser.lastTouches[touch.identifier].x / w;
    var ly = Browser.lastTouches[touch.identifier].y / h;
    var dx = x - lx;
    var dy = y - ly;
    if (touch["deviceID"] === undefined) touch.deviceID = SDL.TOUCH_DEFAULT_ID;
    if (dx === 0 && dy === 0 && event.type === "touchmove") return false;
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 4 >> 2] = _SDL_GetTicks();
    tempI64 = [ touch.deviceID >>> 0, (tempDouble = touch.deviceID, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0) ], HEAP32[ptr + 8 >> 2] = tempI64[0], HEAP32[ptr + 12 >> 2] = tempI64[1];
    tempI64 = [ touch.identifier >>> 0, (tempDouble = touch.identifier, +Math_abs(tempDouble) >= +1 ? tempDouble > +0 ? (Math_min(+Math_floor(tempDouble / +4294967296), +4294967295) | 0) >>> 0 : ~~+Math_ceil((tempDouble - +(~~tempDouble >>> 0)) / +4294967296) >>> 0 : 0) ], HEAP32[ptr + 16 >> 2] = tempI64[0], HEAP32[ptr + 20 >> 2] = tempI64[1];
    HEAPF32[ptr + 24 >> 2] = x;
    HEAPF32[ptr + 28 >> 2] = y;
    HEAPF32[ptr + 32 >> 2] = dx;
    HEAPF32[ptr + 36 >> 2] = dy;
    if (touch.force !== undefined) {
     HEAPF32[ptr + 40 >> 2] = touch.force;
    } else {
     HEAPF32[ptr + 40 >> 2] = event.type == "touchend" ? 0 : 1;
    }
    break;
   }
  case "unload":
   {
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    break;
   }
  case "resize":
   {
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 4 >> 2] = event.w;
    HEAP32[ptr + 8 >> 2] = event.h;
    break;
   }
  case "joystick_button_up":
  case "joystick_button_down":
   {
    var state = event.type === "joystick_button_up" ? 0 : 1;
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP8[ptr + 4 >> 0] = event.index;
    HEAP8[ptr + 5 >> 0] = event.button;
    HEAP8[ptr + 6 >> 0] = state;
    break;
   }
  case "joystick_axis_motion":
   {
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP8[ptr + 4 >> 0] = event.index;
    HEAP8[ptr + 5 >> 0] = event.axis;
    HEAP32[ptr + 8 >> 2] = SDL.joystickAxisValueConversion(event.value);
    break;
   }
  case "focus":
   {
    var SDL_WINDOWEVENT_FOCUS_GAINED = 12;
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 4 >> 2] = 0;
    HEAP8[ptr + 8 >> 0] = SDL_WINDOWEVENT_FOCUS_GAINED;
    break;
   }
  case "blur":
   {
    var SDL_WINDOWEVENT_FOCUS_LOST = 13;
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 4 >> 2] = 0;
    HEAP8[ptr + 8 >> 0] = SDL_WINDOWEVENT_FOCUS_LOST;
    break;
   }
  case "visibilitychange":
   {
    var SDL_WINDOWEVENT_SHOWN = 1;
    var SDL_WINDOWEVENT_HIDDEN = 2;
    var visibilityEventID = event.visible ? SDL_WINDOWEVENT_SHOWN : SDL_WINDOWEVENT_HIDDEN;
    HEAP32[ptr >> 2] = SDL.DOMEventToSDLEvent[event.type];
    HEAP32[ptr + 4 >> 2] = 0;
    HEAP8[ptr + 8 >> 0] = visibilityEventID;
    break;
   }
  default:
   throw "Unhandled SDL event: " + event.type;
  }
 }),
 estimateTextWidth: (function(fontData, text) {
  var h = fontData.size;
  var fontString = h + "px " + fontData.name;
  var tempCtx = SDL.ttfContext;
  assert(tempCtx, "TTF_Init must have been called");
  tempCtx.save();
  tempCtx.font = fontString;
  var ret = tempCtx.measureText(text).width | 0;
  tempCtx.restore();
  return ret;
 }),
 allocateChannels: (function(num) {
  if (SDL.numChannels && SDL.numChannels >= num && num != 0) return;
  SDL.numChannels = num;
  SDL.channels = [];
  for (var i = 0; i < num; i++) {
   SDL.channels[i] = {
    audio: null,
    volume: 1
   };
  }
 }),
 setGetVolume: (function(info, volume) {
  if (!info) return 0;
  var ret = info.volume * 128;
  if (volume != -1) {
   info.volume = Math.min(Math.max(volume, 0), 128) / 128;
   if (info.audio) {
    try {
     info.audio.volume = info.volume;
     if (info.audio.webAudioGainNode) info.audio.webAudioGainNode["gain"]["value"] = info.volume;
    } catch (e) {
     Module.printErr("setGetVolume failed to set audio volume: " + e);
    }
   }
  }
  return ret;
 }),
 setPannerPosition: (function(info, x, y, z) {
  if (!info) return;
  if (info.audio) {
   if (info.audio.webAudioPannerNode) {
    info.audio.webAudioPannerNode["setPosition"](x, y, z);
   }
  }
 }),
 playWebAudio: (function(audio) {
  if (!audio) return;
  if (audio.webAudioNode) return;
  if (!SDL.webAudioAvailable()) return;
  try {
   var webAudio = audio.resource.webAudio;
   audio.paused = false;
   if (!webAudio.decodedBuffer) {
    if (webAudio.onDecodeComplete === undefined) abort("Cannot play back audio object that was not loaded");
    webAudio.onDecodeComplete.push((function() {
     if (!audio.paused) SDL.playWebAudio(audio);
    }));
    return;
   }
   audio.webAudioNode = SDL.audioContext["createBufferSource"]();
   audio.webAudioNode["buffer"] = webAudio.decodedBuffer;
   audio.webAudioNode["loop"] = audio.loop;
   audio.webAudioNode["onended"] = (function() {
    audio["onended"]();
   });
   audio.webAudioPannerNode = SDL.audioContext["createPanner"]();
   audio.webAudioPannerNode["panningModel"] = "equalpower";
   audio.webAudioGainNode = SDL.audioContext["createGain"]();
   audio.webAudioGainNode["gain"]["value"] = audio.volume;
   audio.webAudioNode["connect"](audio.webAudioPannerNode);
   audio.webAudioPannerNode["connect"](audio.webAudioGainNode);
   audio.webAudioGainNode["connect"](SDL.audioContext["destination"]);
   audio.webAudioNode["start"](0, audio.currentPosition);
   audio.startTime = SDL.audioContext["currentTime"] - audio.currentPosition;
  } catch (e) {
   Module.printErr("playWebAudio failed: " + e);
  }
 }),
 pauseWebAudio: (function(audio) {
  if (!audio) return;
  if (audio.webAudioNode) {
   try {
    audio.currentPosition = (SDL.audioContext["currentTime"] - audio.startTime) % audio.resource.webAudio.decodedBuffer.duration;
    audio.webAudioNode["onended"] = undefined;
    audio.webAudioNode.stop(0);
    audio.webAudioNode = undefined;
   } catch (e) {
    Module.printErr("pauseWebAudio failed: " + e);
   }
  }
  audio.paused = true;
 }),
 openAudioContext: (function() {
  if (!SDL.audioContext) {
   if (typeof AudioContext !== "undefined") SDL.audioContext = new AudioContext; else if (typeof webkitAudioContext !== "undefined") SDL.audioContext = new webkitAudioContext;
  }
 }),
 webAudioAvailable: (function() {
  return !!SDL.audioContext;
 }),
 fillWebAudioBufferFromHeap: (function(heapPtr, sizeSamplesPerChannel, dstAudioBuffer) {
  var numChannels = SDL.audio.channels;
  for (var c = 0; c < numChannels; ++c) {
   var channelData = dstAudioBuffer["getChannelData"](c);
   if (channelData.length != sizeSamplesPerChannel) {
    throw "Web Audio output buffer length mismatch! Destination size: " + channelData.length + " samples vs expected " + sizeSamplesPerChannel + " samples!";
   }
   if (SDL.audio.format == 32784) {
    for (var j = 0; j < sizeSamplesPerChannel; ++j) {
     channelData[j] = HEAP16[heapPtr + (j * numChannels + c) * 2 >> 1] / 32768;
    }
   } else if (SDL.audio.format == 8) {
    for (var j = 0; j < sizeSamplesPerChannel; ++j) {
     var v = HEAP8[heapPtr + (j * numChannels + c) >> 0];
     channelData[j] = (v >= 0 ? v - 128 : v + 128) / 128;
    }
   }
  }
 }),
 debugSurface: (function(surfData) {
  console.log("dumping surface " + [ surfData.surf, surfData.source, surfData.width, surfData.height ]);
  var image = surfData.ctx.getImageData(0, 0, surfData.width, surfData.height);
  var data = image.data;
  var num = Math.min(surfData.width, surfData.height);
  for (var i = 0; i < num; i++) {
   console.log("   diagonal " + i + ":" + [ data[i * surfData.width * 4 + i * 4 + 0], data[i * surfData.width * 4 + i * 4 + 1], data[i * surfData.width * 4 + i * 4 + 2], data[i * surfData.width * 4 + i * 4 + 3] ]);
  }
 }),
 joystickEventState: 1,
 lastJoystickState: {},
 joystickNamePool: {},
 recordJoystickState: (function(joystick, state) {
  var buttons = new Array(state.buttons.length);
  for (var i = 0; i < state.buttons.length; i++) {
   buttons[i] = SDL.getJoystickButtonState(state.buttons[i]);
  }
  SDL.lastJoystickState[joystick] = {
   buttons: buttons,
   axes: state.axes.slice(0),
   timestamp: state.timestamp,
   index: state.index,
   id: state.id
  };
 }),
 getJoystickButtonState: (function(button) {
  if (typeof button === "object") {
   return button.pressed;
  } else {
   return button > 0;
  }
 }),
 queryJoysticks: (function() {
  for (var joystick in SDL.lastJoystickState) {
   var state = SDL.getGamepad(joystick - 1);
   var prevState = SDL.lastJoystickState[joystick];
   if (typeof state.timestamp !== "number" || state.timestamp !== prevState.timestamp) {
    var i;
    for (i = 0; i < state.buttons.length; i++) {
     var buttonState = SDL.getJoystickButtonState(state.buttons[i]);
     if (buttonState !== prevState.buttons[i]) {
      SDL.events.push({
       type: buttonState ? "joystick_button_down" : "joystick_button_up",
       joystick: joystick,
       index: joystick - 1,
       button: i
      });
     }
    }
    for (i = 0; i < state.axes.length; i++) {
     if (state.axes[i] !== prevState.axes[i]) {
      SDL.events.push({
       type: "joystick_axis_motion",
       joystick: joystick,
       index: joystick - 1,
       axis: i,
       value: state.axes[i]
      });
     }
    }
    SDL.recordJoystickState(joystick, state);
   }
  }
 }),
 joystickAxisValueConversion: (function(value) {
  value = Math.min(1, Math.max(value, -1));
  return Math.ceil((value + 1) * 32767.5 - 32768);
 }),
 getGamepads: (function() {
  var fcn = navigator.getGamepads || navigator.webkitGamepads || navigator.mozGamepads || navigator.gamepads || navigator.webkitGetGamepads;
  if (fcn !== undefined) {
   return fcn.apply(navigator);
  } else {
   return [];
  }
 }),
 getGamepad: (function(deviceIndex) {
  var gamepads = SDL.getGamepads();
  if (gamepads.length > deviceIndex && deviceIndex >= 0) {
   return gamepads[deviceIndex];
  }
  return null;
 })
};
function _SDL_GL_SwapBuffers() {
 if (Browser.doSwapBuffers) Browser.doSwapBuffers();
}
function _glUniform1iv(location, count, value) {
 location = GL.uniforms[location];
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform1iv(location, value);
}
function _emscripten_glGetVertexAttribiv(index, pname, params) {
 emscriptenWebGLGetVertexAttrib(index, pname, params, "FloatToInteger");
}
function _glReadBuffer(x0) {
 GLctx["readBuffer"](x0);
}
function _glDrawArraysInstanced(mode, first, count, primcount) {
 GLctx["drawArraysInstanced"](mode, first, count, primcount);
}
function _glGenerateMipmap(x0) {
 GLctx["generateMipmap"](x0);
}
function _emscripten_glGetPointerv() {
 Module["printErr"]("missing function: emscripten_glGetPointerv");
 abort(-1);
}
function ___syscall142(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var nfds = SYSCALLS.get(), readfds = SYSCALLS.get(), writefds = SYSCALLS.get(), exceptfds = SYSCALLS.get(), timeout = SYSCALLS.get();
  assert(nfds <= 64, "nfds must be less than or equal to 64");
  assert(!exceptfds, "exceptfds not supported");
  var total = 0;
  var srcReadLow = readfds ? HEAP32[readfds >> 2] : 0, srcReadHigh = readfds ? HEAP32[readfds + 4 >> 2] : 0;
  var srcWriteLow = writefds ? HEAP32[writefds >> 2] : 0, srcWriteHigh = writefds ? HEAP32[writefds + 4 >> 2] : 0;
  var srcExceptLow = exceptfds ? HEAP32[exceptfds >> 2] : 0, srcExceptHigh = exceptfds ? HEAP32[exceptfds + 4 >> 2] : 0;
  var dstReadLow = 0, dstReadHigh = 0;
  var dstWriteLow = 0, dstWriteHigh = 0;
  var dstExceptLow = 0, dstExceptHigh = 0;
  var allLow = (readfds ? HEAP32[readfds >> 2] : 0) | (writefds ? HEAP32[writefds >> 2] : 0) | (exceptfds ? HEAP32[exceptfds >> 2] : 0);
  var allHigh = (readfds ? HEAP32[readfds + 4 >> 2] : 0) | (writefds ? HEAP32[writefds + 4 >> 2] : 0) | (exceptfds ? HEAP32[exceptfds + 4 >> 2] : 0);
  function check(fd, low, high, val) {
   return fd < 32 ? low & val : high & val;
  }
  for (var fd = 0; fd < nfds; fd++) {
   var mask = 1 << fd % 32;
   if (!check(fd, allLow, allHigh, mask)) {
    continue;
   }
   var stream = FS.getStream(fd);
   if (!stream) throw new FS.ErrnoError(ERRNO_CODES.EBADF);
   var flags = SYSCALLS.DEFAULT_POLLMASK;
   if (stream.stream_ops.poll) {
    flags = stream.stream_ops.poll(stream);
   }
   if (flags & 1 && check(fd, srcReadLow, srcReadHigh, mask)) {
    fd < 32 ? dstReadLow = dstReadLow | mask : dstReadHigh = dstReadHigh | mask;
    total++;
   }
   if (flags & 4 && check(fd, srcWriteLow, srcWriteHigh, mask)) {
    fd < 32 ? dstWriteLow = dstWriteLow | mask : dstWriteHigh = dstWriteHigh | mask;
    total++;
   }
   if (flags & 2 && check(fd, srcExceptLow, srcExceptHigh, mask)) {
    fd < 32 ? dstExceptLow = dstExceptLow | mask : dstExceptHigh = dstExceptHigh | mask;
    total++;
   }
  }
  if (readfds) {
   HEAP32[readfds >> 2] = dstReadLow;
   HEAP32[readfds + 4 >> 2] = dstReadHigh;
  }
  if (writefds) {
   HEAP32[writefds >> 2] = dstWriteLow;
   HEAP32[writefds + 4 >> 2] = dstWriteHigh;
  }
  if (exceptfds) {
   HEAP32[exceptfds >> 2] = dstExceptLow;
   HEAP32[exceptfds + 4 >> 2] = dstExceptHigh;
  }
  return total;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall140(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), offset_high = SYSCALLS.get(), offset_low = SYSCALLS.get(), result = SYSCALLS.get(), whence = SYSCALLS.get();
  var offset = offset_low;
  assert(offset_high === 0);
  FS.llseek(stream, offset, whence);
  HEAP32[result >> 2] = stream.position;
  if (stream.getdents && offset === 0 && whence === 0) stream.getdents = null;
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall268(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), size = SYSCALLS.get(), buf = SYSCALLS.get();
  assert(size === 64);
  HEAP32[buf + 4 >> 2] = 4096;
  HEAP32[buf + 40 >> 2] = 4096;
  HEAP32[buf + 8 >> 2] = 1e6;
  HEAP32[buf + 12 >> 2] = 5e5;
  HEAP32[buf + 16 >> 2] = 5e5;
  HEAP32[buf + 20 >> 2] = FS.nextInode;
  HEAP32[buf + 24 >> 2] = 1e6;
  HEAP32[buf + 28 >> 2] = 42;
  HEAP32[buf + 44 >> 2] = 2;
  HEAP32[buf + 36 >> 2] = 255;
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall146(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
  return SYSCALLS.doWritev(stream, iov, iovcnt);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function __isLeapYear(year) {
 return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
function __arraySum(array, index) {
 var sum = 0;
 for (var i = 0; i <= index; sum += array[i++]) ;
 return sum;
}
var __MONTH_DAYS_LEAP = [ 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];
var __MONTH_DAYS_REGULAR = [ 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 ];
function __addDays(date, days) {
 var newDate = new Date(date.getTime());
 while (days > 0) {
  var leap = __isLeapYear(newDate.getFullYear());
  var currentMonth = newDate.getMonth();
  var daysInCurrentMonth = (leap ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR)[currentMonth];
  if (days > daysInCurrentMonth - newDate.getDate()) {
   days -= daysInCurrentMonth - newDate.getDate() + 1;
   newDate.setDate(1);
   if (currentMonth < 11) {
    newDate.setMonth(currentMonth + 1);
   } else {
    newDate.setMonth(0);
    newDate.setFullYear(newDate.getFullYear() + 1);
   }
  } else {
   newDate.setDate(newDate.getDate() + days);
   return newDate;
  }
 }
 return newDate;
}
function _strftime(s, maxsize, format, tm) {
 var tm_zone = HEAP32[tm + 40 >> 2];
 var date = {
  tm_sec: HEAP32[tm >> 2],
  tm_min: HEAP32[tm + 4 >> 2],
  tm_hour: HEAP32[tm + 8 >> 2],
  tm_mday: HEAP32[tm + 12 >> 2],
  tm_mon: HEAP32[tm + 16 >> 2],
  tm_year: HEAP32[tm + 20 >> 2],
  tm_wday: HEAP32[tm + 24 >> 2],
  tm_yday: HEAP32[tm + 28 >> 2],
  tm_isdst: HEAP32[tm + 32 >> 2],
  tm_gmtoff: HEAP32[tm + 36 >> 2],
  tm_zone: tm_zone ? Pointer_stringify(tm_zone) : ""
 };
 var pattern = Pointer_stringify(format);
 var EXPANSION_RULES_1 = {
  "%c": "%a %b %d %H:%M:%S %Y",
  "%D": "%m/%d/%y",
  "%F": "%Y-%m-%d",
  "%h": "%b",
  "%r": "%I:%M:%S %p",
  "%R": "%H:%M",
  "%T": "%H:%M:%S",
  "%x": "%m/%d/%y",
  "%X": "%H:%M:%S"
 };
 for (var rule in EXPANSION_RULES_1) {
  pattern = pattern.replace(new RegExp(rule, "g"), EXPANSION_RULES_1[rule]);
 }
 var WEEKDAYS = [ "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday" ];
 var MONTHS = [ "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December" ];
 function leadingSomething(value, digits, character) {
  var str = typeof value === "number" ? value.toString() : value || "";
  while (str.length < digits) {
   str = character[0] + str;
  }
  return str;
 }
 function leadingNulls(value, digits) {
  return leadingSomething(value, digits, "0");
 }
 function compareByDay(date1, date2) {
  function sgn(value) {
   return value < 0 ? -1 : value > 0 ? 1 : 0;
  }
  var compare;
  if ((compare = sgn(date1.getFullYear() - date2.getFullYear())) === 0) {
   if ((compare = sgn(date1.getMonth() - date2.getMonth())) === 0) {
    compare = sgn(date1.getDate() - date2.getDate());
   }
  }
  return compare;
 }
 function getFirstWeekStartDate(janFourth) {
  switch (janFourth.getDay()) {
  case 0:
   return new Date(janFourth.getFullYear() - 1, 11, 29);
  case 1:
   return janFourth;
  case 2:
   return new Date(janFourth.getFullYear(), 0, 3);
  case 3:
   return new Date(janFourth.getFullYear(), 0, 2);
  case 4:
   return new Date(janFourth.getFullYear(), 0, 1);
  case 5:
   return new Date(janFourth.getFullYear() - 1, 11, 31);
  case 6:
   return new Date(janFourth.getFullYear() - 1, 11, 30);
  }
 }
 function getWeekBasedYear(date) {
  var thisDate = __addDays(new Date(date.tm_year + 1900, 0, 1), date.tm_yday);
  var janFourthThisYear = new Date(thisDate.getFullYear(), 0, 4);
  var janFourthNextYear = new Date(thisDate.getFullYear() + 1, 0, 4);
  var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
  var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
  if (compareByDay(firstWeekStartThisYear, thisDate) <= 0) {
   if (compareByDay(firstWeekStartNextYear, thisDate) <= 0) {
    return thisDate.getFullYear() + 1;
   } else {
    return thisDate.getFullYear();
   }
  } else {
   return thisDate.getFullYear() - 1;
  }
 }
 var EXPANSION_RULES_2 = {
  "%a": (function(date) {
   return WEEKDAYS[date.tm_wday].substring(0, 3);
  }),
  "%A": (function(date) {
   return WEEKDAYS[date.tm_wday];
  }),
  "%b": (function(date) {
   return MONTHS[date.tm_mon].substring(0, 3);
  }),
  "%B": (function(date) {
   return MONTHS[date.tm_mon];
  }),
  "%C": (function(date) {
   var year = date.tm_year + 1900;
   return leadingNulls(year / 100 | 0, 2);
  }),
  "%d": (function(date) {
   return leadingNulls(date.tm_mday, 2);
  }),
  "%e": (function(date) {
   return leadingSomething(date.tm_mday, 2, " ");
  }),
  "%g": (function(date) {
   return getWeekBasedYear(date).toString().substring(2);
  }),
  "%G": (function(date) {
   return getWeekBasedYear(date);
  }),
  "%H": (function(date) {
   return leadingNulls(date.tm_hour, 2);
  }),
  "%I": (function(date) {
   var twelveHour = date.tm_hour;
   if (twelveHour == 0) twelveHour = 12; else if (twelveHour > 12) twelveHour -= 12;
   return leadingNulls(twelveHour, 2);
  }),
  "%j": (function(date) {
   return leadingNulls(date.tm_mday + __arraySum(__isLeapYear(date.tm_year + 1900) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, date.tm_mon - 1), 3);
  }),
  "%m": (function(date) {
   return leadingNulls(date.tm_mon + 1, 2);
  }),
  "%M": (function(date) {
   return leadingNulls(date.tm_min, 2);
  }),
  "%n": (function() {
   return "\n";
  }),
  "%p": (function(date) {
   if (date.tm_hour >= 0 && date.tm_hour < 12) {
    return "AM";
   } else {
    return "PM";
   }
  }),
  "%S": (function(date) {
   return leadingNulls(date.tm_sec, 2);
  }),
  "%t": (function() {
   return "\t";
  }),
  "%u": (function(date) {
   var day = new Date(date.tm_year + 1900, date.tm_mon + 1, date.tm_mday, 0, 0, 0, 0);
   return day.getDay() || 7;
  }),
  "%U": (function(date) {
   var janFirst = new Date(date.tm_year + 1900, 0, 1);
   var firstSunday = janFirst.getDay() === 0 ? janFirst : __addDays(janFirst, 7 - janFirst.getDay());
   var endDate = new Date(date.tm_year + 1900, date.tm_mon, date.tm_mday);
   if (compareByDay(firstSunday, endDate) < 0) {
    var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
    var firstSundayUntilEndJanuary = 31 - firstSunday.getDate();
    var days = firstSundayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
    return leadingNulls(Math.ceil(days / 7), 2);
   }
   return compareByDay(firstSunday, janFirst) === 0 ? "01" : "00";
  }),
  "%V": (function(date) {
   var janFourthThisYear = new Date(date.tm_year + 1900, 0, 4);
   var janFourthNextYear = new Date(date.tm_year + 1901, 0, 4);
   var firstWeekStartThisYear = getFirstWeekStartDate(janFourthThisYear);
   var firstWeekStartNextYear = getFirstWeekStartDate(janFourthNextYear);
   var endDate = __addDays(new Date(date.tm_year + 1900, 0, 1), date.tm_yday);
   if (compareByDay(endDate, firstWeekStartThisYear) < 0) {
    return "53";
   }
   if (compareByDay(firstWeekStartNextYear, endDate) <= 0) {
    return "01";
   }
   var daysDifference;
   if (firstWeekStartThisYear.getFullYear() < date.tm_year + 1900) {
    daysDifference = date.tm_yday + 32 - firstWeekStartThisYear.getDate();
   } else {
    daysDifference = date.tm_yday + 1 - firstWeekStartThisYear.getDate();
   }
   return leadingNulls(Math.ceil(daysDifference / 7), 2);
  }),
  "%w": (function(date) {
   var day = new Date(date.tm_year + 1900, date.tm_mon + 1, date.tm_mday, 0, 0, 0, 0);
   return day.getDay();
  }),
  "%W": (function(date) {
   var janFirst = new Date(date.tm_year, 0, 1);
   var firstMonday = janFirst.getDay() === 1 ? janFirst : __addDays(janFirst, janFirst.getDay() === 0 ? 1 : 7 - janFirst.getDay() + 1);
   var endDate = new Date(date.tm_year + 1900, date.tm_mon, date.tm_mday);
   if (compareByDay(firstMonday, endDate) < 0) {
    var februaryFirstUntilEndMonth = __arraySum(__isLeapYear(endDate.getFullYear()) ? __MONTH_DAYS_LEAP : __MONTH_DAYS_REGULAR, endDate.getMonth() - 1) - 31;
    var firstMondayUntilEndJanuary = 31 - firstMonday.getDate();
    var days = firstMondayUntilEndJanuary + februaryFirstUntilEndMonth + endDate.getDate();
    return leadingNulls(Math.ceil(days / 7), 2);
   }
   return compareByDay(firstMonday, janFirst) === 0 ? "01" : "00";
  }),
  "%y": (function(date) {
   return (date.tm_year + 1900).toString().substring(2);
  }),
  "%Y": (function(date) {
   return date.tm_year + 1900;
  }),
  "%z": (function(date) {
   var off = date.tm_gmtoff;
   var ahead = off >= 0;
   off = Math.abs(off) / 60;
   off = off / 60 * 100 + off % 60;
   return (ahead ? "+" : "-") + String("0000" + off).slice(-4);
  }),
  "%Z": (function(date) {
   return date.tm_zone;
  }),
  "%%": (function() {
   return "%";
  })
 };
 for (var rule in EXPANSION_RULES_2) {
  if (pattern.indexOf(rule) >= 0) {
   pattern = pattern.replace(new RegExp(rule, "g"), EXPANSION_RULES_2[rule](date));
  }
 }
 var bytes = intArrayFromString(pattern, false);
 if (bytes.length > maxsize) {
  return 0;
 }
 writeArrayToMemory(bytes, s);
 return bytes.length - 1;
}
function ___syscall145(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), iov = SYSCALLS.get(), iovcnt = SYSCALLS.get();
  return SYSCALLS.doReadv(stream, iov, iovcnt);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _emscripten_glStencilFuncSeparate(x0, x1, x2, x3) {
 GLctx["stencilFuncSeparate"](x0, x1, x2, x3);
}
function _glUnmapBuffer() {
 Module["printErr"]("missing function: glUnmapBuffer");
 abort(-1);
}
function ___cxa_find_matching_catch() {
 var thrown = EXCEPTIONS.last;
 if (!thrown) {
  return (asm["setTempRet0"](0), 0) | 0;
 }
 var info = EXCEPTIONS.infos[thrown];
 var throwntype = info.type;
 if (!throwntype) {
  return (asm["setTempRet0"](0), thrown) | 0;
 }
 var typeArray = Array.prototype.slice.call(arguments);
 var pointer = Module["___cxa_is_pointer_type"](throwntype);
 if (!___cxa_find_matching_catch.buffer) ___cxa_find_matching_catch.buffer = _malloc(4);
 HEAP32[___cxa_find_matching_catch.buffer >> 2] = thrown;
 thrown = ___cxa_find_matching_catch.buffer;
 for (var i = 0; i < typeArray.length; i++) {
  if (typeArray[i] && Module["___cxa_can_catch"](typeArray[i], throwntype, thrown)) {
   thrown = HEAP32[thrown >> 2];
   info.adjusted = thrown;
   return (asm["setTempRet0"](typeArray[i]), thrown) | 0;
  }
 }
 thrown = HEAP32[thrown >> 2];
 return (asm["setTempRet0"](throwntype), thrown) | 0;
}
function ___cxa_throw(ptr, type, destructor) {
 EXCEPTIONS.infos[ptr] = {
  ptr: ptr,
  adjusted: ptr,
  type: type,
  destructor: destructor,
  refcount: 0,
  caught: false,
  rethrown: false
 };
 EXCEPTIONS.last = ptr;
 if (!("uncaught_exception" in __ZSt18uncaught_exceptionv)) {
  __ZSt18uncaught_exceptionv.uncaught_exception = 1;
 } else {
  __ZSt18uncaught_exceptionv.uncaught_exception++;
 }
 throw ptr;
}
function _emscripten_set_touchend_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 23, "touchend");
 return 0;
}
function _glUseProgram(program) {
 GLctx.useProgram(program ? GL.programs[program] : null);
}
function _emscripten_glDisableVertexAttribArray(index) {
 GLctx.disableVertexAttribArray(index);
}
function _glBindRenderbuffer(target, renderbuffer) {
 GLctx.bindRenderbuffer(target, renderbuffer ? GL.renderbuffers[renderbuffer] : null);
}
function _emscripten_glGenRenderbuffers(n, renderbuffers) {
 for (var i = 0; i < n; i++) {
  var renderbuffer = GLctx.createRenderbuffer();
  if (!renderbuffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[renderbuffers + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.renderbuffers);
  renderbuffer.name = id;
  GL.renderbuffers[id] = renderbuffer;
  HEAP32[renderbuffers + i * 4 >> 2] = id;
 }
}
function _emscripten_glBlendEquation(x0) {
 GLctx["blendEquation"](x0);
}
function ___syscall3(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD(), buf = SYSCALLS.get(), count = SYSCALLS.get();
  return FS.read(stream, HEAP8, buf, count);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _emscripten_glDepthFunc(x0) {
 GLctx["depthFunc"](x0);
}
function _emscripten_set_deviceorientation_callback(userData, useCapture, callbackfunc) {
 JSEvents.registerDeviceOrientationEventCallback(window, userData, useCapture, callbackfunc, 16, "deviceorientation");
 return 0;
}
function ___assert_fail(condition, filename, line, func) {
 ABORT = true;
 throw "Assertion failed: " + Pointer_stringify(condition) + ", at: " + [ filename ? Pointer_stringify(filename) : "unknown filename", line, func ? Pointer_stringify(func) : "unknown function" ] + " at " + stackTrace();
}
function _emscripten_glUniform4iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 4;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform4iv(location, value);
}
function _emscripten_glGetUniformiv(program, location, params) {
 emscriptenWebGLGetUniform(program, location, params, "Integer");
}
function _emscripten_glLoadIdentity() {
 throw "Legacy GL function (glLoadIdentity) called. If you want legacy GL emulation, you need to compile with -s LEGACY_GL_EMULATION=1 to enable legacy GL emulation.";
}
function _emscripten_glVertexAttribDivisor(index, divisor) {
 GLctx["vertexAttribDivisor"](index, divisor);
}
function _glActiveTexture(x0) {
 GLctx["activeTexture"](x0);
}
function _glEnableVertexAttribArray(index) {
 GLctx.enableVertexAttribArray(index);
}
function _glReadPixels(x, y, width, height, format, type, pixels) {
 var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
 if (!pixelData) {
  GL.recordError(1280);
  return;
 }
 GLctx.readPixels(x, y, width, height, format, type, pixelData);
}
function ___syscall6(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var stream = SYSCALLS.getStreamFromFD();
  FS.close(stream);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _emscripten_glDrawElementsInstanced(mode, count, type, indices, primcount) {
 GLctx["drawElementsInstanced"](mode, count, type, indices, primcount);
}
function _glRenderbufferStorageMultisample(x0, x1, x2, x3, x4) {
 GLctx["renderbufferStorageMultisample"](x0, x1, x2, x3, x4);
}
function _glUniformMatrix3fv(location, count, transpose, value) {
 location = GL.uniforms[location];
 var view;
 if (9 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[9 * count - 1];
  for (var i = 0; i < 9 * count; i += 9) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
   view[i + 4] = HEAPF32[value + (4 * i + 16) >> 2];
   view[i + 5] = HEAPF32[value + (4 * i + 20) >> 2];
   view[i + 6] = HEAPF32[value + (4 * i + 24) >> 2];
   view[i + 7] = HEAPF32[value + (4 * i + 28) >> 2];
   view[i + 8] = HEAPF32[value + (4 * i + 32) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 36 >> 2);
 }
 GLctx.uniformMatrix3fv(location, !!transpose, view);
}
function _emscripten_glUniform4f(location, v0, v1, v2, v3) {
 location = GL.uniforms[location];
 GLctx.uniform4f(location, v0, v1, v2, v3);
}
function _emscripten_webgl_create_context(target, attributes) {
 var contextAttributes = {};
 contextAttributes["alpha"] = !!HEAP32[attributes >> 2];
 contextAttributes["depth"] = !!HEAP32[attributes + 4 >> 2];
 contextAttributes["stencil"] = !!HEAP32[attributes + 8 >> 2];
 contextAttributes["antialias"] = !!HEAP32[attributes + 12 >> 2];
 contextAttributes["premultipliedAlpha"] = !!HEAP32[attributes + 16 >> 2];
 contextAttributes["preserveDrawingBuffer"] = !!HEAP32[attributes + 20 >> 2];
 contextAttributes["preferLowPowerToHighPerformance"] = !!HEAP32[attributes + 24 >> 2];
 contextAttributes["failIfMajorPerformanceCaveat"] = !!HEAP32[attributes + 28 >> 2];
 contextAttributes["majorVersion"] = HEAP32[attributes + 32 >> 2];
 contextAttributes["minorVersion"] = HEAP32[attributes + 36 >> 2];
 contextAttributes["explicitSwapControl"] = HEAP32[attributes + 44 >> 2];
 target = Pointer_stringify(target);
 var canvas;
 if ((!target || target === "#canvas") && Module["canvas"]) {
  canvas = Module["canvas"].id ? GL.offscreenCanvases[Module["canvas"].id] || JSEvents.findEventTarget(Module["canvas"].id) : Module["canvas"];
 } else {
  canvas = GL.offscreenCanvases[target] || JSEvents.findEventTarget(target);
 }
 if (!canvas) {
  return 0;
 }
 if (contextAttributes["explicitSwapControl"]) {
  console.error("emscripten_webgl_create_context failed: explicitSwapControl is not supported, please rebuild with -s OFFSCREENCANVAS_SUPPORT=1 to enable targeting the experimental OffscreenCanvas specification!");
  return 0;
 }
 var contextHandle = GL.createContext(canvas, contextAttributes);
 return contextHandle;
}
function _pthread_cleanup_pop() {
 assert(_pthread_cleanup_push.level == __ATEXIT__.length, "cannot pop if something else added meanwhile!");
 __ATEXIT__.pop();
 _pthread_cleanup_push.level = __ATEXIT__.length;
}
function _emscripten_glClearStencil(x0) {
 GLctx["clearStencil"](x0);
}
function _emscripten_glDetachShader(program, shader) {
 GLctx.detachShader(GL.programs[program], GL.shaders[shader]);
}
function _JS_Sound_Stop(channelInstance, delay) {
 if (WEBAudio.audioWebEnabled == 0) return;
 var channel = WEBAudio.audioInstances[channelInstance];
 if (channel.source.buffer) {
  try {
   channel.source.stop(WEBAudio.audioContext.currentTime + delay);
  } catch (e) {
   channel.source.disconnect();
  }
  if (delay == 0) {
   channel.source.onended = (function() {});
   channel.setup();
  }
 }
}
function _emscripten_glDeleteVertexArrays(n, vaos) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[vaos + i * 4 >> 2];
  GLctx["deleteVertexArray"](GL.vaos[id]);
  GL.vaos[id] = null;
 }
}
function _JS_Eval_OpenURL(ptr) {
 var str = Pointer_stringify(ptr);
 location.href = str;
}
function _JS_UNETWebSockets_SocketRecvEvntBuffFromHost(hostId, ptr, length) {
 HEAPU8.set(UNETWebSocketsInstances.hosts[hostId].messages[0], ptr);
}
function _pthread_mutex_destroy() {}
function _glUniformBlockBinding(program, uniformBlockIndex, uniformBlockBinding) {
 program = GL.programs[program];
 GLctx["uniformBlockBinding"](program, uniformBlockIndex, uniformBlockBinding);
}
function _pthread_cond_destroy() {
 return 0;
}
function _emscripten_glGenerateMipmap(x0) {
 GLctx["generateMipmap"](x0);
}
function _getpwuid(uid) {
 return 0;
}
function _emscripten_glCullFace(x0) {
 GLctx["cullFace"](x0);
}
function _emscripten_glUseProgram(program) {
 GLctx.useProgram(program ? GL.programs[program] : null);
}
function _emscripten_glUniformMatrix4fv(location, count, transpose, value) {
 location = GL.uniforms[location];
 var view;
 if (16 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[16 * count - 1];
  for (var i = 0; i < 16 * count; i += 16) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
   view[i + 4] = HEAPF32[value + (4 * i + 16) >> 2];
   view[i + 5] = HEAPF32[value + (4 * i + 20) >> 2];
   view[i + 6] = HEAPF32[value + (4 * i + 24) >> 2];
   view[i + 7] = HEAPF32[value + (4 * i + 28) >> 2];
   view[i + 8] = HEAPF32[value + (4 * i + 32) >> 2];
   view[i + 9] = HEAPF32[value + (4 * i + 36) >> 2];
   view[i + 10] = HEAPF32[value + (4 * i + 40) >> 2];
   view[i + 11] = HEAPF32[value + (4 * i + 44) >> 2];
   view[i + 12] = HEAPF32[value + (4 * i + 48) >> 2];
   view[i + 13] = HEAPF32[value + (4 * i + 52) >> 2];
   view[i + 14] = HEAPF32[value + (4 * i + 56) >> 2];
   view[i + 15] = HEAPF32[value + (4 * i + 60) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 64 >> 2);
 }
 GLctx.uniformMatrix4fv(location, !!transpose, view);
}
function _emscripten_glUniform2fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (2 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[2 * count - 1];
  for (var i = 0; i < 2 * count; i += 2) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 8 >> 2);
 }
 GLctx.uniform2fv(location, view);
}
function _glGetShaderInfoLog(shader, maxLength, length, infoLog) {
 var log = GLctx.getShaderInfoLog(GL.shaders[shader]);
 if (log === null) log = "(unknown error)";
 if (maxLength > 0 && infoLog) {
  var numBytesWrittenExclNull = stringToUTF8(log, infoLog, maxLength);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
function _emscripten_glFramebufferRenderbuffer(target, attachment, renderbuffertarget, renderbuffer) {
 GLctx.framebufferRenderbuffer(target, attachment, renderbuffertarget, GL.renderbuffers[renderbuffer]);
}
function _emscripten_glDeleteFramebuffers(n, framebuffers) {
 for (var i = 0; i < n; ++i) {
  var id = HEAP32[framebuffers + i * 4 >> 2];
  var framebuffer = GL.framebuffers[id];
  if (!framebuffer) continue;
  GLctx.deleteFramebuffer(framebuffer);
  framebuffer.name = 0;
  GL.framebuffers[id] = null;
 }
}
function _emscripten_glUniform2iv(location, count, value) {
 location = GL.uniforms[location];
 count *= 2;
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform2iv(location, value);
}
function _emscripten_glVertexAttrib1fv(index, v) {
 var view = GL.miniTempBufferViews[0];
 view[0] = HEAPF32[v >> 2];
 GLctx.vertexAttrib1fv(index, view);
}
function _glGenBuffers(n, buffers) {
 for (var i = 0; i < n; i++) {
  var buffer = GLctx.createBuffer();
  if (!buffer) {
   GL.recordError(1282);
   while (i < n) HEAP32[buffers + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.buffers);
  buffer.name = id;
  GL.buffers[id] = buffer;
  HEAP32[buffers + i * 4 >> 2] = id;
 }
}
function _emscripten_glBindVertexArray(vao) {
 GLctx["bindVertexArray"](GL.vaos[vao]);
}
function _glCreateProgram() {
 var id = GL.getNewId(GL.programs);
 var program = GLctx.createProgram();
 program.name = id;
 GL.programs[id] = program;
 return id;
}
function _glTexImage3D(target, level, internalFormat, width, height, depth, border, format, type, data) {
 GLctx["texImage3D"](target, level, internalFormat, width, height, depth, border, format, type, HEAPU8.subarray(data));
}
function _emscripten_glGetBufferParameteriv(target, value, data) {
 if (!data) {
  GL.recordError(1281);
  return;
 }
 HEAP32[data >> 2] = GLctx.getBufferParameter(target, value);
}
function _JS_UNETWebSockets_AddHost(pingTimeoutParam) {
 var placeHolderSocket = {
  socket: null,
  buffer: new Uint8Array(0),
  error: null,
  id: -1,
  state: UNETWebSocketsInstances.HostStates.Closed,
  pingTimeout: pingTimeoutParam,
  messages: []
 };
 for (i = 0; i < UNETWebSocketsInstances.hosts.length; i++) {
  if (UNETWebSocketsInstances.hosts[i] == null) {
   placeHolderSocket.id = i;
   UNETWebSocketsInstances.hosts[i] = placeHolderSocket;
   return i;
  }
 }
 return -1;
}
function _JS_SystemInfo_GetBrowserVersionString(buffer, bufferSize) {
 var browserVer = UnityLoader.SystemInfo.browserVersion;
 if (buffer) stringToUTF8(browserVer, buffer, bufferSize);
 return lengthBytesUTF8(browserVer);
}
function _pthread_cond_wait() {
 return 0;
}
function _JS_WebRequest_SetRequestHeader(request, header, value) {
 var _header = Pointer_stringify(header);
 var _value = Pointer_stringify(value);
 wr.requestInstances[request].setRequestHeader(_header, _value);
}
function _JS_Sound_Load(ptr, length) {
 if (WEBAudio.audioWebEnabled == 0) return 0;
 var sound = {
  buffer: null,
  error: false
 };
 var instance = WEBAudio.audioInstances.push(sound) - 1;
 WEBAudio.audioContext.decodeAudioData(HEAPU8.buffer.slice(ptr, ptr + length), (function(buffer) {
  sound.buffer = buffer;
 }), (function() {
  sound.error = true;
  console.log("Decode error.");
 }));
 return instance;
}
function _JS_Eval_ClearTimeout(id) {
 window.clearTimeout(id);
}
function _glGenSamplers(n, samplers) {
 for (var i = 0; i < n; i++) {
  var sampler = GLctx["createSampler"]();
  if (!sampler) {
   GL.recordError(1282);
   while (i < n) HEAP32[samplers + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.samplers);
  sampler.name = id;
  GL.samplers[id] = sampler;
  HEAP32[samplers + i * 4 >> 2] = id;
 }
}
Module["___muldsi3"] = ___muldsi3;
Module["___muldi3"] = ___muldi3;
function _emscripten_glUniform1fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[count - 1];
  for (var i = 0; i < count; ++i) {
   view[i] = HEAPF32[value + 4 * i >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 4 >> 2);
 }
 GLctx.uniform1fv(location, view);
}
var SOCKFS = {
 mount: (function(mount) {
  Module["websocket"] = Module["websocket"] && "object" === typeof Module["websocket"] ? Module["websocket"] : {};
  Module["websocket"]._callbacks = {};
  Module["websocket"]["on"] = (function(event, callback) {
   if ("function" === typeof callback) {
    this._callbacks[event] = callback;
   }
   return this;
  });
  Module["websocket"].emit = (function(event, param) {
   if ("function" === typeof this._callbacks[event]) {
    this._callbacks[event].call(this, param);
   }
  });
  return FS.createNode(null, "/", 16384 | 511, 0);
 }),
 createSocket: (function(family, type, protocol) {
  var streaming = type == 1;
  if (protocol) {
   assert(streaming == (protocol == 6));
  }
  var sock = {
   family: family,
   type: type,
   protocol: protocol,
   server: null,
   error: null,
   peers: {},
   pending: [],
   recv_queue: [],
   sock_ops: SOCKFS.websocket_sock_ops
  };
  var name = SOCKFS.nextname();
  var node = FS.createNode(SOCKFS.root, name, 49152, 0);
  node.sock = sock;
  var stream = FS.createStream({
   path: name,
   node: node,
   flags: FS.modeStringToFlags("r+"),
   seekable: false,
   stream_ops: SOCKFS.stream_ops
  });
  sock.stream = stream;
  return sock;
 }),
 getSocket: (function(fd) {
  var stream = FS.getStream(fd);
  if (!stream || !FS.isSocket(stream.node.mode)) {
   return null;
  }
  return stream.node.sock;
 }),
 stream_ops: {
  poll: (function(stream) {
   var sock = stream.node.sock;
   return sock.sock_ops.poll(sock);
  }),
  ioctl: (function(stream, request, varargs) {
   var sock = stream.node.sock;
   return sock.sock_ops.ioctl(sock, request, varargs);
  }),
  read: (function(stream, buffer, offset, length, position) {
   var sock = stream.node.sock;
   var msg = sock.sock_ops.recvmsg(sock, length);
   if (!msg) {
    return 0;
   }
   buffer.set(msg.buffer, offset);
   return msg.buffer.length;
  }),
  write: (function(stream, buffer, offset, length, position) {
   var sock = stream.node.sock;
   return sock.sock_ops.sendmsg(sock, buffer, offset, length);
  }),
  close: (function(stream) {
   var sock = stream.node.sock;
   sock.sock_ops.close(sock);
  })
 },
 nextname: (function() {
  if (!SOCKFS.nextname.current) {
   SOCKFS.nextname.current = 0;
  }
  return "socket[" + SOCKFS.nextname.current++ + "]";
 }),
 websocket_sock_ops: {
  createPeer: (function(sock, addr, port) {
   var ws;
   if (typeof addr === "object") {
    ws = addr;
    addr = null;
    port = null;
   }
   if (ws) {
    if (ws._socket) {
     addr = ws._socket.remoteAddress;
     port = ws._socket.remotePort;
    } else {
     var result = /ws[s]?:\/\/([^:]+):(\d+)/.exec(ws.url);
     if (!result) {
      throw new Error("WebSocket URL must be in the format ws(s)://address:port");
     }
     addr = result[1];
     port = parseInt(result[2], 10);
    }
   } else {
    try {
     var runtimeConfig = Module["websocket"] && "object" === typeof Module["websocket"];
     var url = "ws:#".replace("#", "//");
     if (runtimeConfig) {
      if ("string" === typeof Module["websocket"]["url"]) {
       url = Module["websocket"]["url"];
      }
     }
     if (url === "ws://" || url === "wss://") {
      var parts = addr.split("/");
      url = url + parts[0] + ":" + port + "/" + parts.slice(1).join("/");
     }
     var subProtocols = "binary";
     if (runtimeConfig) {
      if ("string" === typeof Module["websocket"]["subprotocol"]) {
       subProtocols = Module["websocket"]["subprotocol"];
      }
     }
     subProtocols = subProtocols.replace(/^ +| +$/g, "").split(/ *, */);
     var opts = ENVIRONMENT_IS_NODE ? {
      "protocol": subProtocols.toString()
     } : subProtocols;
     var WebSocketConstructor;
     if (ENVIRONMENT_IS_NODE) {
      WebSocketConstructor = require("ws");
     } else if (ENVIRONMENT_IS_WEB) {
      WebSocketConstructor = window["WebSocket"];
     } else {
      WebSocketConstructor = WebSocket;
     }
     ws = new WebSocketConstructor(url, opts);
     ws.binaryType = "arraybuffer";
    } catch (e) {
     throw new FS.ErrnoError(ERRNO_CODES.EHOSTUNREACH);
    }
   }
   var peer = {
    addr: addr,
    port: port,
    socket: ws,
    dgram_send_queue: []
   };
   SOCKFS.websocket_sock_ops.addPeer(sock, peer);
   SOCKFS.websocket_sock_ops.handlePeerEvents(sock, peer);
   if (sock.type === 2 && typeof sock.sport !== "undefined") {
    peer.dgram_send_queue.push(new Uint8Array([ 255, 255, 255, 255, "p".charCodeAt(0), "o".charCodeAt(0), "r".charCodeAt(0), "t".charCodeAt(0), (sock.sport & 65280) >> 8, sock.sport & 255 ]));
   }
   return peer;
  }),
  getPeer: (function(sock, addr, port) {
   return sock.peers[addr + ":" + port];
  }),
  addPeer: (function(sock, peer) {
   sock.peers[peer.addr + ":" + peer.port] = peer;
  }),
  removePeer: (function(sock, peer) {
   delete sock.peers[peer.addr + ":" + peer.port];
  }),
  handlePeerEvents: (function(sock, peer) {
   var first = true;
   var handleOpen = (function() {
    Module["websocket"].emit("open", sock.stream.fd);
    try {
     var queued = peer.dgram_send_queue.shift();
     while (queued) {
      peer.socket.send(queued);
      queued = peer.dgram_send_queue.shift();
     }
    } catch (e) {
     peer.socket.close();
    }
   });
   function handleMessage(data) {
    assert(typeof data !== "string" && data.byteLength !== undefined);
    if (data.byteLength == 0) {
     return;
    }
    data = new Uint8Array(data);
    var wasfirst = first;
    first = false;
    if (wasfirst && data.length === 10 && data[0] === 255 && data[1] === 255 && data[2] === 255 && data[3] === 255 && data[4] === "p".charCodeAt(0) && data[5] === "o".charCodeAt(0) && data[6] === "r".charCodeAt(0) && data[7] === "t".charCodeAt(0)) {
     var newport = data[8] << 8 | data[9];
     SOCKFS.websocket_sock_ops.removePeer(sock, peer);
     peer.port = newport;
     SOCKFS.websocket_sock_ops.addPeer(sock, peer);
     return;
    }
    sock.recv_queue.push({
     addr: peer.addr,
     port: peer.port,
     data: data
    });
    Module["websocket"].emit("message", sock.stream.fd);
   }
   if (ENVIRONMENT_IS_NODE) {
    peer.socket.on("open", handleOpen);
    peer.socket.on("message", (function(data, flags) {
     if (!flags.binary) {
      return;
     }
     handleMessage((new Uint8Array(data)).buffer);
    }));
    peer.socket.on("close", (function() {
     Module["websocket"].emit("close", sock.stream.fd);
    }));
    peer.socket.on("error", (function(error) {
     sock.error = ERRNO_CODES.ECONNREFUSED;
     Module["websocket"].emit("error", [ sock.stream.fd, sock.error, "ECONNREFUSED: Connection refused" ]);
    }));
   } else {
    peer.socket.onopen = handleOpen;
    peer.socket.onclose = (function() {
     Module["websocket"].emit("close", sock.stream.fd);
    });
    peer.socket.onmessage = function peer_socket_onmessage(event) {
     handleMessage(event.data);
    };
    peer.socket.onerror = (function(error) {
     sock.error = ERRNO_CODES.ECONNREFUSED;
     Module["websocket"].emit("error", [ sock.stream.fd, sock.error, "ECONNREFUSED: Connection refused" ]);
    });
   }
  }),
  poll: (function(sock) {
   if (sock.type === 1 && sock.server) {
    return sock.pending.length ? 64 | 1 : 0;
   }
   var mask = 0;
   var dest = sock.type === 1 ? SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport) : null;
   if (sock.recv_queue.length || !dest || dest && dest.socket.readyState === dest.socket.CLOSING || dest && dest.socket.readyState === dest.socket.CLOSED) {
    mask |= 64 | 1;
   }
   if (!dest || dest && dest.socket.readyState === dest.socket.OPEN) {
    mask |= 4;
   }
   if (dest && dest.socket.readyState === dest.socket.CLOSING || dest && dest.socket.readyState === dest.socket.CLOSED) {
    mask |= 16;
   }
   return mask;
  }),
  ioctl: (function(sock, request, arg) {
   switch (request) {
   case 21531:
    var bytes = 0;
    if (sock.recv_queue.length) {
     bytes = sock.recv_queue[0].data.length;
    }
    HEAP32[arg >> 2] = bytes;
    return 0;
   default:
    return ERRNO_CODES.EINVAL;
   }
  }),
  close: (function(sock) {
   if (sock.server) {
    try {
     sock.server.close();
    } catch (e) {}
    sock.server = null;
   }
   var peers = Object.keys(sock.peers);
   for (var i = 0; i < peers.length; i++) {
    var peer = sock.peers[peers[i]];
    try {
     peer.socket.close();
    } catch (e) {}
    SOCKFS.websocket_sock_ops.removePeer(sock, peer);
   }
   return 0;
  }),
  bind: (function(sock, addr, port) {
   if (typeof sock.saddr !== "undefined" || typeof sock.sport !== "undefined") {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   sock.saddr = addr;
   sock.sport = port;
   if (sock.type === 2) {
    if (sock.server) {
     sock.server.close();
     sock.server = null;
    }
    try {
     sock.sock_ops.listen(sock, 0);
    } catch (e) {
     if (!(e instanceof FS.ErrnoError)) throw e;
     if (e.errno !== ERRNO_CODES.EOPNOTSUPP) throw e;
    }
   }
  }),
  connect: (function(sock, addr, port) {
   if (sock.server) {
    throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
   }
   if (typeof sock.daddr !== "undefined" && typeof sock.dport !== "undefined") {
    var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
    if (dest) {
     if (dest.socket.readyState === dest.socket.CONNECTING) {
      throw new FS.ErrnoError(ERRNO_CODES.EALREADY);
     } else {
      throw new FS.ErrnoError(ERRNO_CODES.EISCONN);
     }
    }
   }
   var peer = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
   sock.daddr = peer.addr;
   sock.dport = peer.port;
   throw new FS.ErrnoError(ERRNO_CODES.EINPROGRESS);
  }),
  listen: (function(sock, backlog) {
   if (!ENVIRONMENT_IS_NODE) {
    throw new FS.ErrnoError(ERRNO_CODES.EOPNOTSUPP);
   }
   if (sock.server) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   var WebSocketServer = require("ws").Server;
   var host = sock.saddr;
   sock.server = new WebSocketServer({
    host: host,
    port: sock.sport
   });
   Module["websocket"].emit("listen", sock.stream.fd);
   sock.server.on("connection", (function(ws) {
    if (sock.type === 1) {
     var newsock = SOCKFS.createSocket(sock.family, sock.type, sock.protocol);
     var peer = SOCKFS.websocket_sock_ops.createPeer(newsock, ws);
     newsock.daddr = peer.addr;
     newsock.dport = peer.port;
     sock.pending.push(newsock);
     Module["websocket"].emit("connection", newsock.stream.fd);
    } else {
     SOCKFS.websocket_sock_ops.createPeer(sock, ws);
     Module["websocket"].emit("connection", sock.stream.fd);
    }
   }));
   sock.server.on("closed", (function() {
    Module["websocket"].emit("close", sock.stream.fd);
    sock.server = null;
   }));
   sock.server.on("error", (function(error) {
    sock.error = ERRNO_CODES.EHOSTUNREACH;
    Module["websocket"].emit("error", [ sock.stream.fd, sock.error, "EHOSTUNREACH: Host is unreachable" ]);
   }));
  }),
  accept: (function(listensock) {
   if (!listensock.server) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
   var newsock = listensock.pending.shift();
   newsock.stream.flags = listensock.stream.flags;
   return newsock;
  }),
  getname: (function(sock, peer) {
   var addr, port;
   if (peer) {
    if (sock.daddr === undefined || sock.dport === undefined) {
     throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
    }
    addr = sock.daddr;
    port = sock.dport;
   } else {
    addr = sock.saddr || 0;
    port = sock.sport || 0;
   }
   return {
    addr: addr,
    port: port
   };
  }),
  sendmsg: (function(sock, buffer, offset, length, addr, port) {
   if (sock.type === 2) {
    if (addr === undefined || port === undefined) {
     addr = sock.daddr;
     port = sock.dport;
    }
    if (addr === undefined || port === undefined) {
     throw new FS.ErrnoError(ERRNO_CODES.EDESTADDRREQ);
    }
   } else {
    addr = sock.daddr;
    port = sock.dport;
   }
   var dest = SOCKFS.websocket_sock_ops.getPeer(sock, addr, port);
   if (sock.type === 1) {
    if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
     throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
    } else if (dest.socket.readyState === dest.socket.CONNECTING) {
     throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
    }
   }
   var data;
   if (buffer instanceof Array || buffer instanceof ArrayBuffer) {
    data = buffer.slice(offset, offset + length);
   } else {
    data = buffer.buffer.slice(buffer.byteOffset + offset, buffer.byteOffset + offset + length);
   }
   if (sock.type === 2) {
    if (!dest || dest.socket.readyState !== dest.socket.OPEN) {
     if (!dest || dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
      dest = SOCKFS.websocket_sock_ops.createPeer(sock, addr, port);
     }
     dest.dgram_send_queue.push(data);
     return length;
    }
   }
   try {
    dest.socket.send(data);
    return length;
   } catch (e) {
    throw new FS.ErrnoError(ERRNO_CODES.EINVAL);
   }
  }),
  recvmsg: (function(sock, length) {
   if (sock.type === 1 && sock.server) {
    throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
   }
   var queued = sock.recv_queue.shift();
   if (!queued) {
    if (sock.type === 1) {
     var dest = SOCKFS.websocket_sock_ops.getPeer(sock, sock.daddr, sock.dport);
     if (!dest) {
      throw new FS.ErrnoError(ERRNO_CODES.ENOTCONN);
     } else if (dest.socket.readyState === dest.socket.CLOSING || dest.socket.readyState === dest.socket.CLOSED) {
      return null;
     } else {
      throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
     }
    } else {
     throw new FS.ErrnoError(ERRNO_CODES.EAGAIN);
    }
   }
   var queuedLength = queued.data.byteLength || queued.data.length;
   var queuedOffset = queued.data.byteOffset || 0;
   var queuedBuffer = queued.data.buffer || queued.data;
   var bytesRead = Math.min(length, queuedLength);
   var res = {
    buffer: new Uint8Array(queuedBuffer, queuedOffset, bytesRead),
    addr: queued.addr,
    port: queued.port
   };
   if (sock.type === 1 && bytesRead < queuedLength) {
    var bytesRemaining = queuedLength - bytesRead;
    queued.data = new Uint8Array(queuedBuffer, queuedOffset + bytesRead, bytesRemaining);
    sock.recv_queue.unshift(queued);
   }
   return res;
  })
 }
};
var _htons = undefined;
Module["_htons"] = _htons;
function __inet_pton6_raw(str) {
 var words;
 var w, offset, z;
 var valid6regx = /^((?=.*::)(?!.*::.+::)(::)?([\dA-F]{1,4}:(:|\b)|){5}|([\dA-F]{1,4}:){6})((([\dA-F]{1,4}((?!\3)::|:\b|$))|(?!\2\3)){2}|(((2[0-4]|1\d|[1-9])?\d|25[0-5])\.?\b){4})$/i;
 var parts = [];
 if (!valid6regx.test(str)) {
  return null;
 }
 if (str === "::") {
  return [ 0, 0, 0, 0, 0, 0, 0, 0 ];
 }
 if (str.indexOf("::") === 0) {
  str = str.replace("::", "Z:");
 } else {
  str = str.replace("::", ":Z:");
 }
 if (str.indexOf(".") > 0) {
  str = str.replace(new RegExp("[.]", "g"), ":");
  words = str.split(":");
  words[words.length - 4] = parseInt(words[words.length - 4]) + parseInt(words[words.length - 3]) * 256;
  words[words.length - 3] = parseInt(words[words.length - 2]) + parseInt(words[words.length - 1]) * 256;
  words = words.slice(0, words.length - 2);
 } else {
  words = str.split(":");
 }
 offset = 0;
 z = 0;
 for (w = 0; w < words.length; w++) {
  if (typeof words[w] === "string") {
   if (words[w] === "Z") {
    for (z = 0; z < 8 - words.length + 1; z++) {
     parts[w + z] = 0;
    }
    offset = z - 1;
   } else {
    parts[w + offset] = _htons(parseInt(words[w], 16));
   }
  } else {
   parts[w + offset] = words[w];
  }
 }
 return [ parts[1] << 16 | parts[0], parts[3] << 16 | parts[2], parts[5] << 16 | parts[4], parts[7] << 16 | parts[6] ];
}
var DNS = {
 address_map: {
  id: 1,
  addrs: {},
  names: {}
 },
 lookup_name: (function(name) {
  var res = __inet_pton4_raw(name);
  if (res !== null) {
   return name;
  }
  res = __inet_pton6_raw(name);
  if (res !== null) {
   return name;
  }
  var addr;
  if (DNS.address_map.addrs[name]) {
   addr = DNS.address_map.addrs[name];
  } else {
   var id = DNS.address_map.id++;
   assert(id < 65535, "exceeded max address mappings of 65535");
   addr = "172.29." + (id & 255) + "." + (id & 65280);
   DNS.address_map.names[addr] = name;
   DNS.address_map.addrs[name] = addr;
  }
  return addr;
 }),
 lookup_addr: (function(addr) {
  if (DNS.address_map.names[addr]) {
   return DNS.address_map.names[addr];
  }
  return null;
 })
};
var Sockets = {
 BUFFER_SIZE: 10240,
 MAX_BUFFER_SIZE: 10485760,
 nextFd: 1,
 fds: {},
 nextport: 1,
 maxport: 65535,
 peer: null,
 connections: {},
 portmap: {},
 localAddr: 4261412874,
 addrPool: [ 33554442, 50331658, 67108874, 83886090, 100663306, 117440522, 134217738, 150994954, 167772170, 184549386, 201326602, 218103818, 234881034 ]
};
function __inet_ntop4_raw(addr) {
 return (addr & 255) + "." + (addr >> 8 & 255) + "." + (addr >> 16 & 255) + "." + (addr >> 24 & 255);
}
function __inet_ntop6_raw(ints) {
 var str = "";
 var word = 0;
 var longest = 0;
 var lastzero = 0;
 var zstart = 0;
 var len = 0;
 var i = 0;
 var parts = [ ints[0] & 65535, ints[0] >> 16, ints[1] & 65535, ints[1] >> 16, ints[2] & 65535, ints[2] >> 16, ints[3] & 65535, ints[3] >> 16 ];
 var hasipv4 = true;
 var v4part = "";
 for (i = 0; i < 5; i++) {
  if (parts[i] !== 0) {
   hasipv4 = false;
   break;
  }
 }
 if (hasipv4) {
  v4part = __inet_ntop4_raw(parts[6] | parts[7] << 16);
  if (parts[5] === -1) {
   str = "::ffff:";
   str += v4part;
   return str;
  }
  if (parts[5] === 0) {
   str = "::";
   if (v4part === "0.0.0.0") v4part = "";
   if (v4part === "0.0.0.1") v4part = "1";
   str += v4part;
   return str;
  }
 }
 for (word = 0; word < 8; word++) {
  if (parts[word] === 0) {
   if (word - lastzero > 1) {
    len = 0;
   }
   lastzero = word;
   len++;
  }
  if (len > longest) {
   longest = len;
   zstart = word - longest + 1;
  }
 }
 for (word = 0; word < 8; word++) {
  if (longest > 1) {
   if (parts[word] === 0 && word >= zstart && word < zstart + longest) {
    if (word === zstart) {
     str += ":";
     if (zstart === 0) str += ":";
    }
    continue;
   }
  }
  str += Number(_ntohs(parts[word] & 65535)).toString(16);
  str += word < 7 ? ":" : "";
 }
 return str;
}
function __read_sockaddr(sa, salen) {
 var family = HEAP16[sa >> 1];
 var port = _ntohs(HEAP16[sa + 2 >> 1]);
 var addr;
 switch (family) {
 case 2:
  if (salen !== 16) {
   return {
    errno: ERRNO_CODES.EINVAL
   };
  }
  addr = HEAP32[sa + 4 >> 2];
  addr = __inet_ntop4_raw(addr);
  break;
 case 10:
  if (salen !== 28) {
   return {
    errno: ERRNO_CODES.EINVAL
   };
  }
  addr = [ HEAP32[sa + 8 >> 2], HEAP32[sa + 12 >> 2], HEAP32[sa + 16 >> 2], HEAP32[sa + 20 >> 2] ];
  addr = __inet_ntop6_raw(addr);
  break;
 default:
  return {
   errno: ERRNO_CODES.EAFNOSUPPORT
  };
 }
 return {
  family: family,
  addr: addr,
  port: port
 };
}
function __write_sockaddr(sa, family, addr, port) {
 switch (family) {
 case 2:
  addr = __inet_pton4_raw(addr);
  HEAP16[sa >> 1] = family;
  HEAP32[sa + 4 >> 2] = addr;
  HEAP16[sa + 2 >> 1] = _htons(port);
  break;
 case 10:
  addr = __inet_pton6_raw(addr);
  HEAP32[sa >> 2] = family;
  HEAP32[sa + 8 >> 2] = addr[0];
  HEAP32[sa + 12 >> 2] = addr[1];
  HEAP32[sa + 16 >> 2] = addr[2];
  HEAP32[sa + 20 >> 2] = addr[3];
  HEAP16[sa + 2 >> 1] = _htons(port);
  HEAP32[sa + 4 >> 2] = 0;
  HEAP32[sa + 24 >> 2] = 0;
  break;
 default:
  return {
   errno: ERRNO_CODES.EAFNOSUPPORT
  };
 }
 return {};
}
function ___syscall102(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var call = SYSCALLS.get(), socketvararg = SYSCALLS.get();
  SYSCALLS.varargs = socketvararg;
  switch (call) {
  case 1:
   {
    var domain = SYSCALLS.get(), type = SYSCALLS.get(), protocol = SYSCALLS.get();
    var sock = SOCKFS.createSocket(domain, type, protocol);
    assert(sock.stream.fd < 64);
    return sock.stream.fd;
   }
  case 2:
   {
    var sock = SYSCALLS.getSocketFromFD(), info = SYSCALLS.getSocketAddress();
    sock.sock_ops.bind(sock, info.addr, info.port);
    return 0;
   }
  case 3:
   {
    var sock = SYSCALLS.getSocketFromFD(), info = SYSCALLS.getSocketAddress();
    sock.sock_ops.connect(sock, info.addr, info.port);
    return 0;
   }
  case 4:
   {
    var sock = SYSCALLS.getSocketFromFD(), backlog = SYSCALLS.get();
    sock.sock_ops.listen(sock, backlog);
    return 0;
   }
  case 5:
   {
    var sock = SYSCALLS.getSocketFromFD(), addr = SYSCALLS.get(), addrlen = SYSCALLS.get();
    var newsock = sock.sock_ops.accept(sock);
    if (addr) {
     var res = __write_sockaddr(addr, newsock.family, DNS.lookup_name(newsock.daddr), newsock.dport);
     assert(!res.errno);
    }
    return newsock.stream.fd;
   }
  case 6:
   {
    var sock = SYSCALLS.getSocketFromFD(), addr = SYSCALLS.get(), addrlen = SYSCALLS.get();
    var res = __write_sockaddr(addr, sock.family, DNS.lookup_name(sock.saddr || "0.0.0.0"), sock.sport);
    assert(!res.errno);
    return 0;
   }
  case 7:
   {
    var sock = SYSCALLS.getSocketFromFD(), addr = SYSCALLS.get(), addrlen = SYSCALLS.get();
    if (!sock.daddr) {
     return -ERRNO_CODES.ENOTCONN;
    }
    var res = __write_sockaddr(addr, sock.family, DNS.lookup_name(sock.daddr), sock.dport);
    assert(!res.errno);
    return 0;
   }
  case 11:
   {
    var sock = SYSCALLS.getSocketFromFD(), message = SYSCALLS.get(), length = SYSCALLS.get(), flags = SYSCALLS.get(), dest = SYSCALLS.getSocketAddress(true);
    if (!dest) {
     return FS.write(sock.stream, HEAP8, message, length);
    } else {
     return sock.sock_ops.sendmsg(sock, HEAP8, message, length, dest.addr, dest.port);
    }
   }
  case 12:
   {
    var sock = SYSCALLS.getSocketFromFD(), buf = SYSCALLS.get(), len = SYSCALLS.get(), flags = SYSCALLS.get(), addr = SYSCALLS.get(), addrlen = SYSCALLS.get();
    var msg = sock.sock_ops.recvmsg(sock, len);
    if (!msg) return 0;
    if (addr) {
     var res = __write_sockaddr(addr, sock.family, DNS.lookup_name(msg.addr), msg.port);
     assert(!res.errno);
    }
    HEAPU8.set(msg.buffer, buf);
    return msg.buffer.byteLength;
   }
  case 14:
   {
    return -ERRNO_CODES.ENOPROTOOPT;
   }
  case 15:
   {
    var sock = SYSCALLS.getSocketFromFD(), level = SYSCALLS.get(), optname = SYSCALLS.get(), optval = SYSCALLS.get(), optlen = SYSCALLS.get();
    if (level === 1) {
     if (optname === 4) {
      HEAP32[optval >> 2] = sock.error;
      HEAP32[optlen >> 2] = 4;
      sock.error = null;
      return 0;
     }
    }
    return -ERRNO_CODES.ENOPROTOOPT;
   }
  case 16:
   {
    var sock = SYSCALLS.getSocketFromFD(), message = SYSCALLS.get(), flags = SYSCALLS.get();
    var iov = HEAP32[message + 8 >> 2];
    var num = HEAP32[message + 12 >> 2];
    var addr, port;
    var name = HEAP32[message >> 2];
    var namelen = HEAP32[message + 4 >> 2];
    if (name) {
     var info = __read_sockaddr(name, namelen);
     if (info.errno) return -info.errno;
     port = info.port;
     addr = DNS.lookup_addr(info.addr) || info.addr;
    }
    var total = 0;
    for (var i = 0; i < num; i++) {
     total += HEAP32[iov + (8 * i + 4) >> 2];
    }
    var view = new Uint8Array(total);
    var offset = 0;
    for (var i = 0; i < num; i++) {
     var iovbase = HEAP32[iov + (8 * i + 0) >> 2];
     var iovlen = HEAP32[iov + (8 * i + 4) >> 2];
     for (var j = 0; j < iovlen; j++) {
      view[offset++] = HEAP8[iovbase + j >> 0];
     }
    }
    return sock.sock_ops.sendmsg(sock, view, 0, total, addr, port);
   }
  case 17:
   {
    var sock = SYSCALLS.getSocketFromFD(), message = SYSCALLS.get(), flags = SYSCALLS.get();
    var iov = HEAP32[message + 8 >> 2];
    var num = HEAP32[message + 12 >> 2];
    var total = 0;
    for (var i = 0; i < num; i++) {
     total += HEAP32[iov + (8 * i + 4) >> 2];
    }
    var msg = sock.sock_ops.recvmsg(sock, total);
    if (!msg) return 0;
    var name = HEAP32[message >> 2];
    if (name) {
     var res = __write_sockaddr(name, sock.family, DNS.lookup_name(msg.addr), msg.port);
     assert(!res.errno);
    }
    var bytesRead = 0;
    var bytesRemaining = msg.buffer.byteLength;
    for (var i = 0; bytesRemaining > 0 && i < num; i++) {
     var iovbase = HEAP32[iov + (8 * i + 0) >> 2];
     var iovlen = HEAP32[iov + (8 * i + 4) >> 2];
     if (!iovlen) {
      continue;
     }
     var length = Math.min(iovlen, bytesRemaining);
     var buf = msg.buffer.subarray(bytesRead, bytesRead + length);
     HEAPU8.set(buf, iovbase + bytesRead);
     bytesRead += length;
     bytesRemaining -= length;
    }
    return bytesRead;
   }
  default:
   abort("unsupported socketcall syscall " + call);
  }
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glDeleteBuffers(n, buffers) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[buffers + i * 4 >> 2];
  var buffer = GL.buffers[id];
  if (!buffer) continue;
  GLctx.deleteBuffer(buffer);
  buffer.name = 0;
  GL.buffers[id] = null;
  if (id == GL.currArrayBuffer) GL.currArrayBuffer = 0;
  if (id == GL.currElementArrayBuffer) GL.currElementArrayBuffer = 0;
 }
}
function _glScissor(x0, x1, x2, x3) {
 GLctx["scissor"](x0, x1, x2, x3);
}
function _JS_SystemInfo_GetLanguage(buffer, bufferSize) {
 var language = UnityLoader.SystemInfo.language;
 if (buffer) stringToUTF8(language, buffer, bufferSize);
 return lengthBytesUTF8(language);
}
function _emscripten_glCheckFramebufferStatus(x0) {
 return GLctx["checkFramebufferStatus"](x0);
}
function _emscripten_glDeleteProgram(id) {
 if (!id) return;
 var program = GL.programs[id];
 if (!program) {
  GL.recordError(1281);
  return;
 }
 GLctx.deleteProgram(program);
 program.name = 0;
 GL.programs[id] = null;
 GL.programInfos[id] = null;
}
function _emscripten_glDisable(x0) {
 GLctx["disable"](x0);
}
function _glUniform3uiv(location, count, value) {
 location = GL.uniforms[location];
 count *= 3;
 value = HEAPU32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform3uiv(location, value);
}
function _glClearColor(x0, x1, x2, x3) {
 GLctx["clearColor"](x0, x1, x2, x3);
}
function _emscripten_glGetActiveAttrib(program, index, bufSize, length, size, type, name) {
 program = GL.programs[program];
 var info = GLctx.getActiveAttrib(program, index);
 if (!info) return;
 if (bufSize > 0 && name) {
  var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
 if (size) HEAP32[size >> 2] = info.size;
 if (type) HEAP32[type >> 2] = info.type;
}
function _emscripten_glLineWidth(x0) {
 GLctx["lineWidth"](x0);
}
function _emscripten_glGetString(name_) {
 if (GL.stringCache[name_]) return GL.stringCache[name_];
 var ret;
 switch (name_) {
 case 7936:
 case 7937:
 case 37445:
 case 37446:
  ret = allocate(intArrayFromString(GLctx.getParameter(name_)), "i8", ALLOC_NORMAL);
  break;
 case 7938:
  var glVersion = GLctx.getParameter(GLctx.VERSION);
  if (GLctx.canvas.GLctxObject.version >= 2) glVersion = "OpenGL ES 3.0 (" + glVersion + ")"; else {
   glVersion = "OpenGL ES 2.0 (" + glVersion + ")";
  }
  ret = allocate(intArrayFromString(glVersion), "i8", ALLOC_NORMAL);
  break;
 case 7939:
  var exts = GLctx.getSupportedExtensions();
  var gl_exts = [];
  for (var i = 0; i < exts.length; ++i) {
   gl_exts.push(exts[i]);
   gl_exts.push("GL_" + exts[i]);
  }
  ret = allocate(intArrayFromString(gl_exts.join(" ")), "i8", ALLOC_NORMAL);
  break;
 case 35724:
  var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
  var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
  var ver_num = glslVersion.match(ver_re);
  if (ver_num !== null) {
   if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + "0";
   glslVersion = "OpenGL ES GLSL ES " + ver_num[1] + " (" + glslVersion + ")";
  }
  ret = allocate(intArrayFromString(glslVersion), "i8", ALLOC_NORMAL);
  break;
 default:
  GL.recordError(1280);
  return 0;
 }
 GL.stringCache[name_] = ret;
 return ret;
}
function _emscripten_glGetAttribLocation(program, name) {
 program = GL.programs[program];
 name = Pointer_stringify(name);
 return GLctx.getAttribLocation(program, name);
}
function _emscripten_glGetIntegerv(name_, p) {
 emscriptenWebGLGet(name_, p, "Integer");
}
function _glGetStringi(name, index) {
 if (GLctx.canvas.GLctxObject.version < 2) {
  GL.recordError(1282);
  return 0;
 }
 var stringiCache = GL.stringiCache[name];
 if (stringiCache) {
  if (index < 0 || index >= stringiCache.length) {
   GL.recordError(1281);
   return 0;
  }
  return stringiCache[index];
 }
 switch (name) {
 case 7939:
  var exts = GLctx.getSupportedExtensions();
  var gl_exts = [];
  for (var i = 0; i < exts.length; ++i) {
   gl_exts.push(allocate(intArrayFromString(exts[i]), "i8", ALLOC_NORMAL));
   gl_exts.push(allocate(intArrayFromString("GL_" + exts[i]), "i8", ALLOC_NORMAL));
  }
  stringiCache = GL.stringiCache[name] = gl_exts;
  if (index < 0 || index >= stringiCache.length) {
   GL.recordError(1281);
   return 0;
  }
  return stringiCache[index];
 default:
  GL.recordError(1280);
  return 0;
 }
}
function _JS_Sound_SetLoop(channelInstance, loop) {
 if (WEBAudio.audioWebEnabled == 0) return;
 WEBAudio.audioInstances[channelInstance].source.loop = loop;
}
function _JS_Sound_Load_PCM(channels, length, sampleRate, ptr) {
 if (WEBAudio.audioWebEnabled == 0) return 0;
 var sound = {
  buffer: WEBAudio.audioContext.createBuffer(channels, length, sampleRate),
  error: false
 };
 for (var i = 0; i < channels; i++) {
  var offs = (ptr >> 2) + length * i;
  var buffer = sound.buffer;
  var copyToChannel = buffer["copyToChannel"] || (function(source, channelNumber, startInChannel) {
   var clipped = source.subarray(0, Math.min(source.length, this.length - (startInChannel | 0)));
   this.getChannelData(channelNumber | 0).set(clipped, startInChannel | 0);
  });
  copyToChannel.apply(buffer, [ HEAPF32.subarray(offs, offs + length), i, 0 ]);
 }
 var instance = WEBAudio.audioInstances.push(sound) - 1;
 return instance;
}
function _JS_UNETWebSockets_SocketCleanEvntFromHost(hostId) {
 if (UNETWebSocketsInstances.hosts[hostId].state == UNETWebSocketsInstances.HostStates.Opening) UNETWebSocketsInstances.hosts[hostId].state = UNETWebSocketsInstances.HostStates.Connected; else if (UNETWebSocketsInstances.hosts[hostId].messages.length != 0) UNETWebSocketsInstances.hosts[hostId].messages.shift(); else if (UNETWebSocketsInstances.hosts[hostId].state == UNETWebSocketsInstances.HostStates.Closing) {
  UNETWebSocketsInstances.hosts[hostId].state = UNETWebSocketsInstances.HostStates.Closed;
  UNETWebSocketsInstances.hosts[hostId] = null;
  _JS_UNETWebSockets_HostsContainingMessagesCleanHost(hostId);
 }
}
function _glUniform2fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (2 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[2 * count - 1];
  for (var i = 0; i < 2 * count; i += 2) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 8 >> 2);
 }
 GLctx.uniform2fv(location, view);
}
function _emscripten_glReadPixels(x, y, width, height, format, type, pixels) {
 var pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, format);
 if (!pixelData) {
  GL.recordError(1280);
  return;
 }
 GLctx.readPixels(x, y, width, height, format, type, pixelData);
}
function __setLetterbox(element, topBottom, leftRight) {
 if (JSEvents.isInternetExplorer()) {
  element.style.marginLeft = element.style.marginRight = leftRight + "px";
  element.style.marginTop = element.style.marginBottom = topBottom + "px";
 } else {
  element.style.paddingLeft = element.style.paddingRight = leftRight + "px";
  element.style.paddingTop = element.style.paddingBottom = topBottom + "px";
 }
}
function _emscripten_do_request_fullscreen(target, strategy) {
 if (typeof JSEvents.fullscreenEnabled() === "undefined") return -1;
 if (!JSEvents.fullscreenEnabled()) return -3;
 if (!target) target = "#canvas";
 target = JSEvents.findEventTarget(target);
 if (!target) return -4;
 if (!target.requestFullscreen && !target.msRequestFullscreen && !target.mozRequestFullScreen && !target.mozRequestFullscreen && !target.webkitRequestFullscreen) {
  return -3;
 }
 var canPerformRequests = JSEvents.canPerformEventHandlerRequests();
 if (!canPerformRequests) {
  if (strategy.deferUntilInEventHandler) {
   JSEvents.deferCall(JSEvents.requestFullscreen, 1, [ target, strategy ]);
   return 1;
  } else {
   return -2;
  }
 }
 return JSEvents.requestFullscreen(target, strategy);
}
function _emscripten_request_fullscreen(target, deferUntilInEventHandler) {
 var strategy = {};
 strategy.scaleMode = 0;
 strategy.canvasResolutionScaleMode = 0;
 strategy.filteringMode = 0;
 strategy.deferUntilInEventHandler = deferUntilInEventHandler;
 return _emscripten_do_request_fullscreen(target, strategy);
}
function _emscripten_glGetError() {
 if (GL.lastError) {
  var error = GL.lastError;
  GL.lastError = 0;
  return error;
 } else {
  return GLctx.getError();
 }
}
function _emscripten_glFramebufferTexture2D(target, attachment, textarget, texture, level) {
 GLctx.framebufferTexture2D(target, attachment, textarget, GL.textures[texture], level);
}
function ___syscall39(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), mode = SYSCALLS.get();
  return SYSCALLS.doMkdir(path, mode);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall38(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var old_path = SYSCALLS.getStr(), new_path = SYSCALLS.getStr();
  FS.rename(old_path, new_path);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall33(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), amode = SYSCALLS.get();
  return SYSCALLS.doAccess(path, amode);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glClearDepthf(x0) {
 GLctx["clearDepth"](x0);
}
function _glGenTransformFeedbacks(n, ids) {
 for (var i = 0; i < n; i++) {
  var transformFeedback = GLctx["createTransformFeedback"]();
  if (!transformFeedback) {
   GL.recordError(1282);
   while (i < n) HEAP32[ids + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.transformFeedbacks);
  transformFeedback.name = id;
  GL.transformFeedbacks[id] = transformFeedback;
  HEAP32[ids + i * 4 >> 2] = id;
 }
}
Module["_memmove"] = _memmove;
function _glDepthFunc(x0) {
 GLctx["depthFunc"](x0);
}
Module["___uremdi3"] = ___uremdi3;
function _glCompressedTexSubImage2D(target, level, xoffset, yoffset, width, height, format, imageSize, data) {
 var heapView;
 if (data) {
  heapView = HEAPU8.subarray(data, data + imageSize);
 } else {
  heapView = null;
 }
 GLctx["compressedTexSubImage2D"](target, level, xoffset, yoffset, width, height, format, heapView);
}
function _glGenTextures(n, textures) {
 for (var i = 0; i < n; i++) {
  var texture = GLctx.createTexture();
  if (!texture) {
   GL.recordError(1282);
   while (i < n) HEAP32[textures + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.textures);
  texture.name = id;
  GL.textures[id] = texture;
  HEAP32[textures + i * 4 >> 2] = id;
 }
}
function _glProgramBinary(program, binaryFormat, binary, length) {
 GL.recordError(1280);
}
function _JS_SystemInfo_GetHeight() {
 return UnityLoader.SystemInfo.height;
}
function _JS_SystemInfo_GetOS(buffer, bufferSize) {
 var browser = UnityLoader.SystemInfo.os + " " + UnityLoader.SystemInfo.osVersion;
 if (buffer) stringToUTF8(browser, buffer, bufferSize);
 return lengthBytesUTF8(browser);
}
function ___syscall51(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  return -ERRNO_CODES.ENOSYS;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function ___syscall42() {
 return ___syscall51.apply(null, arguments);
}
function ___syscall40(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr();
  FS.rmdir(path);
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _JS_WebRequest_SetResponseHandler(request, arg, onresponse) {
 var http = wr.requestInstances[request];
 http.onload = function http_onload(e) {
  if (onresponse) {
   var kWebRequestOK = 0;
   var byteArray = new Uint8Array(http.response);
   if (byteArray.length != 0) {
    var buffer = _malloc(byteArray.length);
    HEAPU8.set(byteArray, buffer);
    Runtime.dynCall("viiiiii", onresponse, [ arg, http.status, buffer, byteArray.length, 0, kWebRequestOK ]);
   } else {
    Runtime.dynCall("viiiiii", onresponse, [ arg, http.status, 0, 0, 0, kWebRequestOK ]);
   }
  }
 };
 function HandleError(err, code) {
  if (onresponse) {
   var len = lengthBytesUTF8(err) + 1;
   var buffer = _malloc(len);
   stringToUTF8(err, buffer, len);
   Runtime.dynCall("viiiiii", onresponse, [ arg, http.status, 0, 0, buffer, code ]);
   _free(buffer);
  }
 }
 http.onerror = function http_onerror(e) {
  var kWebErrorUnknown = 2;
  HandleError("Unknown error.", kWebErrorUnknown);
 };
 http.ontimeout = function http_onerror(e) {
  var kWebErrorTimeout = 14;
  HandleError("Connection timed out.", kWebErrorTimeout);
 };
 http.onabort = function http_onerror(e) {
  var kWebErrorAborted = 17;
  HandleError("Aborted.", kWebErrorAborted);
 };
}
function _JS_SystemInfo_GetWidth() {
 return UnityLoader.SystemInfo.width;
}
function _glClientWaitSync(sync, flags, timeoutLo, timeoutHi) {
 timeoutLo == timeoutLo >>> 0;
 timeoutHi == timeoutHi >>> 0;
 var timeout = timeoutLo == 4294967295 && timeoutHi == 4294967295 ? -1 : Runtime.makeBigInt(timeoutLo, timeoutHi, true);
 return GLctx.clientWaitSync(GL.syncs[sync], flags, timeout);
}
function _emscripten_glGetUniformfv(program, location, params) {
 emscriptenWebGLGetUniform(program, location, params, "Float");
}
function ___gxx_personality_v0() {}
function _emscripten_exit_pointerlock() {
 JSEvents.removeDeferredCalls(JSEvents.requestPointerLock);
 if (document.exitPointerLock) {
  document.exitPointerLock();
 } else if (document.msExitPointerLock) {
  document.msExitPointerLock();
 } else if (document.mozExitPointerLock) {
  document.mozExitPointerLock();
 } else if (document.webkitExitPointerLock) {
  document.webkitExitPointerLock();
 } else {
  return -1;
 }
 return 0;
}
function _emscripten_glBindBuffer(target, buffer) {
 var bufferObj = buffer ? GL.buffers[buffer] : null;
 GLctx.bindBuffer(target, bufferObj);
}
function _glBlendEquation(x0) {
 GLctx["blendEquation"](x0);
}
function _glGetUniformLocation(program, name) {
 name = Pointer_stringify(name);
 var arrayOffset = 0;
 if (name.indexOf("]", name.length - 1) !== -1) {
  var ls = name.lastIndexOf("[");
  var arrayIndex = name.slice(ls + 1, -1);
  if (arrayIndex.length > 0) {
   arrayOffset = parseInt(arrayIndex);
   if (arrayOffset < 0) {
    return -1;
   }
  }
  name = name.slice(0, ls);
 }
 var ptable = GL.programInfos[program];
 if (!ptable) {
  return -1;
 }
 var utable = ptable.uniforms;
 var uniformInfo = utable[name];
 if (uniformInfo && arrayOffset < uniformInfo[0]) {
  return uniformInfo[1] + arrayOffset;
 } else {
  return -1;
 }
}
function _emscripten_glFinish() {
 GLctx["finish"]();
}
function _glEndTransformFeedback() {
 GLctx["endTransformFeedback"]();
}
function _emscripten_glUniform1iv(location, count, value) {
 location = GL.uniforms[location];
 value = HEAP32.subarray(value >> 2, value + count * 4 >> 2);
 GLctx.uniform1iv(location, value);
}
function _glUniform4fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (4 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[4 * count - 1];
  for (var i = 0; i < 4 * count; i += 4) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 16 >> 2);
 }
 GLctx.uniform4fv(location, view);
}
function _emscripten_glTexCoordPointer() {
 Module["printErr"]("missing function: emscripten_glTexCoordPointer");
 abort(-1);
}
function _glBeginTransformFeedback(x0) {
 GLctx["beginTransformFeedback"](x0);
}
function __exit(status) {
 Module["exit"](status);
}
function _exit(status) {
 __exit(status);
}
function _pthread_setspecific(key, value) {
 if (!(key in PTHREAD_SPECIFIC)) {
  return ERRNO_CODES.EINVAL;
 }
 PTHREAD_SPECIFIC[key] = value;
 return 0;
}
function _emscripten_glVertexAttrib1f(x0, x1) {
 GLctx["vertexAttrib1f"](x0, x1);
}
function _glDeleteTransformFeedbacks(n, ids) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[ids + i * 4 >> 2];
  var transformFeedback = GL.transformFeedbacks[id];
  if (!transformFeedback) continue;
  GLctx["deleteTransformFeedback"](transformFeedback);
  transformFeedback.name = 0;
  GL.transformFeedbacks[id] = null;
 }
}
function _glCheckFramebufferStatus(x0) {
 return GLctx["checkFramebufferStatus"](x0);
}
function _gmtime_r(time, tmPtr) {
 var date = new Date(HEAP32[time >> 2] * 1e3);
 HEAP32[tmPtr >> 2] = date.getUTCSeconds();
 HEAP32[tmPtr + 4 >> 2] = date.getUTCMinutes();
 HEAP32[tmPtr + 8 >> 2] = date.getUTCHours();
 HEAP32[tmPtr + 12 >> 2] = date.getUTCDate();
 HEAP32[tmPtr + 16 >> 2] = date.getUTCMonth();
 HEAP32[tmPtr + 20 >> 2] = date.getUTCFullYear() - 1900;
 HEAP32[tmPtr + 24 >> 2] = date.getUTCDay();
 HEAP32[tmPtr + 36 >> 2] = 0;
 HEAP32[tmPtr + 32 >> 2] = 0;
 var start = Date.UTC(date.getUTCFullYear(), 0, 1, 0, 0, 0, 0);
 var yday = (date.getTime() - start) / (1e3 * 60 * 60 * 24) | 0;
 HEAP32[tmPtr + 28 >> 2] = yday;
 HEAP32[tmPtr + 40 >> 2] = ___tm_timezone;
 return tmPtr;
}
function _gmtime(time) {
 return _gmtime_r(time, ___tm_current);
}
function _glBindAttribLocation(program, index, name) {
 name = Pointer_stringify(name);
 GLctx.bindAttribLocation(GL.programs[program], index, name);
}
function _emscripten_glShaderBinary() {
 GL.recordError(1280);
}
function _JS_UNETWebSockets_SocketStop() {
 for (i = 0; i < UNETWebSocketsInstances.hosts.length; i++) {
  if (UNETWebSocketsInstances.hosts[i] != null && UNETWebSocketsInstances.hosts[i].socket != null) {
   var socket = UNETWebSocketsInstances.hosts[i];
   socket.socket.close();
   UNETWebSocketsInstances.hosts[i] = null;
  }
 }
 UNETWebSocketsInstances.hosts = new Array(UNETWebSocketsInstances.hosts.length);
 UNETWebSocketsInstances.hostsContainingMessages = new Array;
}
function _emscripten_glBlendColor(x0, x1, x2, x3) {
 GLctx["blendColor"](x0, x1, x2, x3);
}
function _JS_UNETWebSockets_Init() {
 UNETWebSocketsInstances.pingDataArray = new ArrayBuffer(1);
 var arr = new Uint8Array(UNETWebSocketsInstances.pingDataArray);
 arr[0] = 255;
}
Module["___udivdi3"] = ___udivdi3;
function _emscripten_glUniform4fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (4 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[4 * count - 1];
  for (var i = 0; i < 4 * count; i += 4) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 16 >> 2);
 }
 GLctx.uniform4fv(location, view);
}
function _glBufferSubData(target, offset, size, data) {
 GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data + size));
}
function _glMapBufferRange() {
 Module["printErr"]("missing function: glMapBufferRange");
 abort(-1);
}
Module["_llvm_ctlz_i64"] = _llvm_ctlz_i64;
function _emscripten_glBindTexture(target, texture) {
 GLctx.bindTexture(target, texture ? GL.textures[texture] : null);
}
function _emscripten_glUniform1i(location, v0) {
 location = GL.uniforms[location];
 GLctx.uniform1i(location, v0);
}
function _emscripten_glVertexAttrib2fv(index, v) {
 var view = GL.miniTempBufferViews[1];
 view[0] = HEAPF32[v >> 2];
 view[1] = HEAPF32[v + 4 >> 2];
 GLctx.vertexAttrib2fv(index, view);
}
function _glGetShaderPrecisionFormat(shaderType, precisionType, range, precision) {
 var result = GLctx.getShaderPrecisionFormat(shaderType, precisionType);
 HEAP32[range >> 2] = result.rangeMin;
 HEAP32[range + 4 >> 2] = result.rangeMax;
 HEAP32[precision >> 2] = result.precision;
}
Module["_roundf"] = _roundf;
function _emscripten_glDeleteObjectARB() {
 Module["printErr"]("missing function: emscripten_glDeleteObjectARB");
 abort(-1);
}
function _emscripten_set_touchmove_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerTouchEventCallback(target, userData, useCapture, callbackfunc, 24, "touchmove");
 return 0;
}
function _emscripten_glUniform1f(location, v0) {
 location = GL.uniforms[location];
 GLctx.uniform1f(location, v0);
}
function _emscripten_glVertexAttribPointer(index, size, type, normalized, stride, ptr) {
 GLctx.vertexAttribPointer(index, size, type, !!normalized, stride, ptr);
}
function _glShaderSource(shader, count, string, length) {
 var source = GL.getSource(shader, count, string, length);
 GLctx.shaderSource(GL.shaders[shader], source);
}
function _pthread_create() {
 return 11;
}
function _JS_WebRequest_Create(url, method) {
 var http = new XMLHttpRequest;
 var _url = Pointer_stringify(url);
 var _method = Pointer_stringify(method);
 http.open(_method, _url, true);
 http.responseType = "arraybuffer";
 wr.requestInstances[wr.nextRequestId] = http;
 return wr.nextRequestId++;
}
function _emscripten_set_keypress_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 1, "keypress");
 return 0;
}
function _JS_SystemInfo_GetCurrentCanvasHeight() {
 return Module["canvas"].clientHeight;
}
var PTHREAD_SPECIFIC_NEXT_KEY = 1;
function _pthread_key_create(key, destructor) {
 if (key == 0) {
  return ERRNO_CODES.EINVAL;
 }
 HEAP32[key >> 2] = PTHREAD_SPECIFIC_NEXT_KEY;
 PTHREAD_SPECIFIC[PTHREAD_SPECIFIC_NEXT_KEY] = 0;
 PTHREAD_SPECIFIC_NEXT_KEY++;
 return 0;
}
function _glBeginQuery(target, id) {
 GLctx["beginQuery"](target, id ? GL.queries[id] : null);
}
function _glGetUniformBlockIndex(program, uniformBlockName) {
 program = GL.programs[program];
 uniformBlockName = Pointer_stringify(uniformBlockName);
 return GLctx["getUniformBlockIndex"](program, uniformBlockName);
}
function _glBindBuffer(target, buffer) {
 var bufferObj = buffer ? GL.buffers[buffer] : null;
 GLctx.bindBuffer(target, bufferObj);
}
function _pthread_mutexattr_destroy() {}
function ___syscall91(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var addr = SYSCALLS.get(), len = SYSCALLS.get();
  var info = SYSCALLS.mappings[addr];
  if (!info) return 0;
  if (len === info.len) {
   var stream = FS.getStream(info.fd);
   SYSCALLS.doMsync(addr, stream, len, info.flags);
   FS.munmap(stream);
   SYSCALLS.mappings[addr] = null;
   if (info.allocated) {
    _free(info.malloc);
   }
  }
  return 0;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _pthread_cond_timedwait() {
 return 0;
}
function _emscripten_glAttachShader(program, shader) {
 GLctx.attachShader(GL.programs[program], GL.shaders[shader]);
}
function _glGetProgramBinary(program, bufSize, length, binaryFormat, binary) {
 GL.recordError(1282);
}
function _glBufferData(target, size, data, usage) {
 switch (usage) {
 case 35041:
 case 35042:
  usage = 35040;
  break;
 case 35045:
 case 35046:
  usage = 35044;
  break;
 case 35049:
 case 35050:
  usage = 35048;
  break;
 }
 if (!data) {
  GLctx.bufferData(target, size, usage);
 } else {
  GLctx.bufferData(target, HEAPU8.subarray(data, data + size), usage);
 }
}
function _sched_yield() {
 return 0;
}
function _emscripten_glGetRenderbufferParameteriv(target, pname, params) {
 if (!params) {
  GL.recordError(1281);
  return;
 }
 HEAP32[params >> 2] = GLctx.getRenderbufferParameter(target, pname);
}
function _glGetError() {
 if (GL.lastError) {
  var error = GL.lastError;
  GL.lastError = 0;
  return error;
 } else {
  return GLctx.getError();
 }
}
function _emscripten_glDrawBuffers(n, bufs) {
 var bufArray = [];
 for (var i = 0; i < n; i++) bufArray.push(HEAP32[bufs + i * 4 >> 2]);
 GLctx["drawBuffers"](bufArray);
}
Module["_pthread_mutex_unlock"] = _pthread_mutex_unlock;
function _emscripten_glBindFramebuffer(target, framebuffer) {
 GLctx.bindFramebuffer(target, framebuffer ? GL.framebuffers[framebuffer] : null);
}
function _emscripten_glBufferSubData(target, offset, size, data) {
 GLctx.bufferSubData(target, offset, HEAPU8.subarray(data, data + size));
}
function _JS_Cursor_SetShow(show) {
 Module.canvas.style.cursor = show ? "default" : "none";
}
function _emscripten_set_keydown_callback(target, userData, useCapture, callbackfunc) {
 JSEvents.registerKeyEventCallback(target, userData, useCapture, callbackfunc, 2, "keydown");
 return 0;
}
Module["_sbrk"] = _sbrk;
Module["_bitshift64Shl"] = _bitshift64Shl;
function _glGetIntegerv(name_, p) {
 emscriptenWebGLGet(name_, p, "Integer");
}
function ___syscall85(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var path = SYSCALLS.getStr(), buf = SYSCALLS.get(), bufsize = SYSCALLS.get();
  return SYSCALLS.doReadlink(path, buf, bufsize);
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _difftime(time1, time0) {
 return time1 - time0;
}
function _glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
 var pixelData = null;
 if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat);
 GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixelData);
}
function _glStencilMask(x0) {
 GLctx["stencilMask"](x0);
}
function _pthread_mutexattr_settype() {}
function _glUniform1fv(location, count, value) {
 location = GL.uniforms[location];
 var view;
 if (count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[count - 1];
  for (var i = 0; i < count; ++i) {
   view[i] = HEAPF32[value + 4 * i >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 4 >> 2);
 }
 GLctx.uniform1fv(location, view);
}
function _glGetShaderSource(shader, bufSize, length, source) {
 var result = GLctx.getShaderSource(GL.shaders[shader]);
 if (!result) return;
 if (bufSize > 0 && source) {
  var numBytesWrittenExclNull = stringToUTF8(result, source, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
}
Module["___divdi3"] = ___divdi3;
function _JS_Cursor_SetImage(ptr, length) {
 var binary = "";
 for (var i = 0; i < length; i++) binary += String.fromCharCode(HEAPU8[ptr + i]);
 Module.canvas.style.cursor = "url(data:image/cur;base64," + btoa(binary) + "),default";
}
function ___unlock() {}
function _JS_WebRequest_Release(request) {
 var http = wr.requestInstances[request];
 http.onload = null;
 http.onerror = null;
 http.ontimeout = null;
 http.onabort = null;
 delete http;
 wr.requestInstances[request] = null;
}
function _setenv(envname, envval, overwrite) {
 if (envname === 0) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 var name = Pointer_stringify(envname);
 var val = Pointer_stringify(envval);
 if (name === "" || name.indexOf("=") !== -1) {
  ___setErrNo(ERRNO_CODES.EINVAL);
  return -1;
 }
 if (ENV.hasOwnProperty(name) && !overwrite) return 0;
 ENV[name] = val;
 ___buildEnvironment(ENV);
 return 0;
}
function ___cxa_allocate_exception(size) {
 return _malloc(size);
}
function _emscripten_glGetProgramiv(program, pname, p) {
 if (!p) {
  GL.recordError(1281);
  return;
 }
 if (program >= GL.counter) {
  GL.recordError(1281);
  return;
 }
 var ptable = GL.programInfos[program];
 if (!ptable) {
  GL.recordError(1282);
  return;
 }
 if (pname == 35716) {
  var log = GLctx.getProgramInfoLog(GL.programs[program]);
  if (log === null) log = "(unknown error)";
  HEAP32[p >> 2] = log.length + 1;
 } else if (pname == 35719) {
  HEAP32[p >> 2] = ptable.maxUniformLength;
 } else if (pname == 35722) {
  if (ptable.maxAttributeLength == -1) {
   var program = GL.programs[program];
   var numAttribs = GLctx.getProgramParameter(program, GLctx.ACTIVE_ATTRIBUTES);
   ptable.maxAttributeLength = 0;
   for (var i = 0; i < numAttribs; ++i) {
    var activeAttrib = GLctx.getActiveAttrib(program, i);
    ptable.maxAttributeLength = Math.max(ptable.maxAttributeLength, activeAttrib.name.length + 1);
   }
  }
  HEAP32[p >> 2] = ptable.maxAttributeLength;
 } else if (pname == 35381) {
  if (ptable.maxUniformBlockNameLength == -1) {
   var program = GL.programs[program];
   var numBlocks = GLctx.getProgramParameter(program, GLctx.ACTIVE_UNIFORM_BLOCKS);
   ptable.maxUniformBlockNameLength = 0;
   for (var i = 0; i < numBlocks; ++i) {
    var activeBlockName = GLctx.getActiveUniformBlockName(program, i);
    ptable.maxUniformBlockNameLength = Math.max(ptable.maxUniformBlockNameLength, activeBlockName.length + 1);
   }
  }
  HEAP32[p >> 2] = ptable.maxUniformBlockNameLength;
 } else {
  HEAP32[p >> 2] = GLctx.getProgramParameter(GL.programs[program], pname);
 }
}
function _emscripten_glTexImage2D(target, level, internalFormat, width, height, border, format, type, pixels) {
 var pixelData = null;
 if (pixels) pixelData = emscriptenWebGLGetTexPixelData(type, format, width, height, pixels, internalFormat);
 GLctx.texImage2D(target, level, internalFormat, width, height, border, format, type, pixelData);
}
function _emscripten_glGenVertexArrays(n, arrays) {
 for (var i = 0; i < n; i++) {
  var vao = GLctx["createVertexArray"]();
  if (!vao) {
   GL.recordError(1282);
   while (i < n) HEAP32[arrays + i++ * 4 >> 2] = 0;
   return;
  }
  var id = GL.getNewId(GL.vaos);
  vao.name = id;
  GL.vaos[id] = vao;
  HEAP32[arrays + i * 4 >> 2] = id;
 }
}
function _glFlushMappedBufferRange() {
 Module["printErr"]("missing function: glFlushMappedBufferRange");
 abort(-1);
}
function _glCopyBufferSubData(x0, x1, x2, x3, x4) {
 GLctx["copyBufferSubData"](x0, x1, x2, x3, x4);
}
function ___syscall183(which, varargs) {
 SYSCALLS.varargs = varargs;
 try {
  var buf = SYSCALLS.get(), size = SYSCALLS.get();
  if (size === 0) return -ERRNO_CODES.EINVAL;
  var cwd = FS.cwd();
  if (size < cwd.length + 1) return -ERRNO_CODES.ERANGE;
  writeAsciiToMemory(cwd, buf);
  return buf;
 } catch (e) {
  if (typeof FS === "undefined" || !(e instanceof FS.ErrnoError)) abort(e);
  return -e.errno;
 }
}
function _glDepthMask(flag) {
 GLctx.depthMask(!!flag);
}
function _llvm_eh_typeid_for(type) {
 return type;
}
function _glUniformMatrix4fv(location, count, transpose, value) {
 location = GL.uniforms[location];
 var view;
 if (16 * count <= GL.MINI_TEMP_BUFFER_SIZE) {
  view = GL.miniTempBufferViews[16 * count - 1];
  for (var i = 0; i < 16 * count; i += 16) {
   view[i] = HEAPF32[value + 4 * i >> 2];
   view[i + 1] = HEAPF32[value + (4 * i + 4) >> 2];
   view[i + 2] = HEAPF32[value + (4 * i + 8) >> 2];
   view[i + 3] = HEAPF32[value + (4 * i + 12) >> 2];
   view[i + 4] = HEAPF32[value + (4 * i + 16) >> 2];
   view[i + 5] = HEAPF32[value + (4 * i + 20) >> 2];
   view[i + 6] = HEAPF32[value + (4 * i + 24) >> 2];
   view[i + 7] = HEAPF32[value + (4 * i + 28) >> 2];
   view[i + 8] = HEAPF32[value + (4 * i + 32) >> 2];
   view[i + 9] = HEAPF32[value + (4 * i + 36) >> 2];
   view[i + 10] = HEAPF32[value + (4 * i + 40) >> 2];
   view[i + 11] = HEAPF32[value + (4 * i + 44) >> 2];
   view[i + 12] = HEAPF32[value + (4 * i + 48) >> 2];
   view[i + 13] = HEAPF32[value + (4 * i + 52) >> 2];
   view[i + 14] = HEAPF32[value + (4 * i + 56) >> 2];
   view[i + 15] = HEAPF32[value + (4 * i + 60) >> 2];
  }
 } else {
  view = HEAPF32.subarray(value >> 2, value + count * 64 >> 2);
 }
 GLctx.uniformMatrix4fv(location, !!transpose, view);
}
function _emscripten_glClientActiveTexture() {
 Module["printErr"]("missing function: emscripten_glClientActiveTexture");
 abort(-1);
}
function _glGetActiveUniform(program, index, bufSize, length, size, type, name) {
 program = GL.programs[program];
 var info = GLctx.getActiveUniform(program, index);
 if (!info) return;
 if (bufSize > 0 && name) {
  var numBytesWrittenExclNull = stringToUTF8(info.name, name, bufSize);
  if (length) HEAP32[length >> 2] = numBytesWrittenExclNull;
 } else {
  if (length) HEAP32[length >> 2] = 0;
 }
 if (size) HEAP32[size >> 2] = info.size;
 if (type) HEAP32[type >> 2] = info.type;
}
function _emscripten_glValidateProgram(program) {
 GLctx.validateProgram(GL.programs[program]);
}
function _emscripten_get_main_loop_timing(mode, value) {
 if (mode) HEAP32[mode >> 2] = Browser.mainLoop.timingMode;
 if (value) HEAP32[value >> 2] = Browser.mainLoop.timingValue;
}
function _JS_WebRequest_SetTimeout(request, timeout) {
 wr.requestInstances[request].timeout = timeout;
}
function _glFrontFace(x0) {
 GLctx["frontFace"](x0);
}
function _emscripten_webgl_get_current_context() {
 return GL.currentContext ? GL.currentContext.handle : 0;
}
function _emscripten_glPixelStorei(pname, param) {
 if (pname == 3333) {
  GL.packAlignment = param;
 } else if (pname == 3317) {
  GL.unpackAlignment = param;
 }
 GLctx.pixelStorei(pname, param);
}
function _emscripten_glDeleteTextures(n, textures) {
 for (var i = 0; i < n; i++) {
  var id = HEAP32[textures + i * 4 >> 2];
  var texture = GL.textures[id];
  if (!texture) continue;
  GLctx.deleteTexture(texture);
  texture.name = 0;
  GL.textures[id] = null;
 }
}
function _glGetString(name_) {
 if (GL.stringCache[name_]) return GL.stringCache[name_];
 var ret;
 switch (name_) {
 case 7936:
 case 7937:
 case 37445:
 case 37446:
  ret = allocate(intArrayFromString(GLctx.getParameter(name_)), "i8", ALLOC_NORMAL);
  break;
 case 7938:
  var glVersion = GLctx.getParameter(GLctx.VERSION);
  if (GLctx.canvas.GLctxObject.version >= 2) glVersion = "OpenGL ES 3.0 (" + glVersion + ")"; else {
   glVersion = "OpenGL ES 2.0 (" + glVersion + ")";
  }
  ret = allocate(intArrayFromString(glVersion), "i8", ALLOC_NORMAL);
  break;
 case 7939:
  var exts = GLctx.getSupportedExtensions();
  var gl_exts = [];
  for (var i = 0; i < exts.length; ++i) {
   gl_exts.push(exts[i]);
   gl_exts.push("GL_" + exts[i]);
  }
  ret = allocate(intArrayFromString(gl_exts.join(" ")), "i8", ALLOC_NORMAL);
  break;
 case 35724:
  var glslVersion = GLctx.getParameter(GLctx.SHADING_LANGUAGE_VERSION);
  var ver_re = /^WebGL GLSL ES ([0-9]\.[0-9][0-9]?)(?:$| .*)/;
  var ver_num = glslVersion.match(ver_re);
  if (ver_num !== null) {
   if (ver_num[1].length == 3) ver_num[1] = ver_num[1] + "0";
   glslVersion = "OpenGL ES GLSL ES " + ver_num[1] + " (" + glslVersion + ")";
  }
  ret = allocate(intArrayFromString(glslVersion), "i8", ALLOC_NORMAL);
  break;
 default:
  GL.recordError(1280);
  return 0;
 }
 GL.stringCache[name_] = ret;
 return ret;
}
Module["_llvm_bswap_i16"] = _llvm_bswap_i16;
function _time(ptr) {
 var ret = Date.now() / 1e3 | 0;
 if (ptr) {
  HEAP32[ptr >> 2] = ret;
 }
 return ret;
}
Module["_pthread_self"] = _pthread_self;
function _emscripten_glGetBooleanv(name_, p) {
 emscriptenWebGLGet(name_, p, "Boolean");
}
function _emscripten_glCompileShader(shader) {
 GLctx.compileShader(GL.shaders[shader]);
}
var GLctx;
GL.init();
Module["requestFullScreen"] = function Module_requestFullScreen(lockPointer, resizeCanvas, vrDevice) {
 Module.printErr("Module.requestFullScreen is deprecated. Please call Module.requestFullscreen instead.");
 Module["requestFullScreen"] = Module["requestFullscreen"];
 Browser.requestFullScreen(lockPointer, resizeCanvas, vrDevice);
};
Module["requestFullscreen"] = function Module_requestFullscreen(lockPointer, resizeCanvas, vrDevice) {
 Browser.requestFullscreen(lockPointer, resizeCanvas, vrDevice);
};
Module["requestAnimationFrame"] = function Module_requestAnimationFrame(func) {
 Browser.requestAnimationFrame(func);
};
Module["setCanvasSize"] = function Module_setCanvasSize(width, height, noUpdates) {
 Browser.setCanvasSize(width, height, noUpdates);
};
Module["pauseMainLoop"] = function Module_pauseMainLoop() {
 Browser.mainLoop.pause();
};
Module["resumeMainLoop"] = function Module_resumeMainLoop() {
 Browser.mainLoop.resume();
};
Module["getUserMedia"] = function Module_getUserMedia() {
 Browser.getUserMedia();
};
Module["createContext"] = function Module_createContext(canvas, useWebGL, setInModule, webGLContextAttributes) {
 return Browser.createContext(canvas, useWebGL, setInModule, webGLContextAttributes);
};
if (ENVIRONMENT_IS_NODE) {
 _emscripten_get_now = function _emscripten_get_now_actual() {
  var t = process["hrtime"]();
  return t[0] * 1e3 + t[1] / 1e6;
 };
} else if (typeof dateNow !== "undefined") {
 _emscripten_get_now = dateNow;
} else if (typeof self === "object" && self["performance"] && typeof self["performance"]["now"] === "function") {
 _emscripten_get_now = (function() {
  return self["performance"]["now"]();
 });
} else if (typeof performance === "object" && typeof performance["now"] === "function") {
 _emscripten_get_now = (function() {
  return performance["now"]();
 });
} else {
 _emscripten_get_now = Date.now;
}
FS.staticInit();
__ATINIT__.unshift((function() {
 if (!Module["noFSInit"] && !FS.init.initialized) FS.init();
}));
__ATMAIN__.push((function() {
 FS.ignorePermissions = false;
}));
__ATEXIT__.push((function() {
 FS.quit();
}));
Module["FS_createFolder"] = FS.createFolder;
Module["FS_createPath"] = FS.createPath;
Module["FS_createDataFile"] = FS.createDataFile;
Module["FS_createPreloadedFile"] = FS.createPreloadedFile;
Module["FS_createLazyFile"] = FS.createLazyFile;
Module["FS_createLink"] = FS.createLink;
Module["FS_createDevice"] = FS.createDevice;
Module["FS_unlink"] = FS.unlink;
__ATINIT__.unshift((function() {
 TTY.init();
}));
__ATEXIT__.push((function() {
 TTY.shutdown();
}));
if (ENVIRONMENT_IS_NODE) {
 var fs = require("fs");
 var NODEJS_PATH = require("path");
 NODEFS.staticInit();
}
___buildEnvironment(ENV);
__ATINIT__.push((function() {
 SOCKFS.root = FS.mount(SOCKFS, {}, null);
}));
DYNAMICTOP_PTR = allocate(1, "i32", ALLOC_STATIC);
STACK_BASE = STACKTOP = Runtime.alignMemory(STATICTOP);
STACK_MAX = STACK_BASE + TOTAL_STACK;
DYNAMIC_BASE = Runtime.alignMemory(STACK_MAX);
HEAP32[DYNAMICTOP_PTR >> 2] = DYNAMIC_BASE;
staticSealed = true;
assert(DYNAMIC_BASE < TOTAL_MEMORY, "TOTAL_MEMORY not big enough for stack");
function nullFunc_viiifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_diddi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'diddi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiiiiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiiiiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iidi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iidi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiiiiifiiiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiiiiifiiiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vfff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vfff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vidd(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vidd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iidiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iidiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_di(x) {
 Module["printErr"]("Invalid function pointer called with signature 'di'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_didiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'didiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiffiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiffiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_dii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'dii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_didi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'didi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iidii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iidii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiiiffffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiiiffffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vdd(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vdd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_difi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'difi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vdddddd(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vdddddd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vffffffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vffffffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiiiiiiiiiiiiiiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiifffiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiifffiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iifff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iifff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fifffffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fifffffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiffiiiiiiiiiffffiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiffiiiiiiiiiffffiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_diii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'diii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiffifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiffifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiififi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiififi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viidii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viidii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiififi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiififi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiifiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiifiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vid(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vid'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiffiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiffiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viidi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viidi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vf(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vf'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiffiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiffiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiiiiiiifiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiiiiiiifiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiffffffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiffffffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_diiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'diiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffffffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffffffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiffffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiffffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiffifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiffifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_didii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'didii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiifii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiifii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_f(x) {
 Module["printErr"]("Invalid function pointer called with signature 'f'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vffff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vffff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiifiiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiifiiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viififi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viififi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_v(x) {
 Module["printErr"]("Invalid function pointer called with signature 'v'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vd(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vd'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiffiiiiiiiiiffffiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiffiiiiiiiiiffffiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_ii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'ii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiifiiiiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiifiiiiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiiiiiiiiiiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiiiiiiiiiiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fidi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fidi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiif(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiif'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_diiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'diiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiififfi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiififfi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiifi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiifi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_fiiffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'fiiffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiffiiiiiiiiiffffiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiffiiiiiiiiiffffiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifffii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifffii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiifiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiifiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_ff(x) {
 Module["printErr"]("Invalid function pointer called with signature 'ff'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiifiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiifiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiififfi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiififfi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vfi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vfi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_i(x) {
 Module["printErr"]("Invalid function pointer called with signature 'i'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiidii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiidii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiifiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiifiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viiiiifffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viiiiifffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vidi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vidi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_iiiiiiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'iiiiiiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_vifiiii(x) {
 Module["printErr"]("Invalid function pointer called with signature 'vifiiii'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function nullFunc_viffffi(x) {
 Module["printErr"]("Invalid function pointer called with signature 'viffffi'. Perhaps this is an invalid value (e.g. caused by calling a virtual method on a NULL pointer)? Or calling a function with an incorrect type, which will fail? (it is worth building your source files with -Werror (warnings are errors), as warnings can indicate undefined behavior which can cause this)");
 Module["printErr"]("Build with ASSERTIONS=2 for more info.");
 abort(x);
}
function invoke_viiifiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiifiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_diddi(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_diddi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiff(index, a1, a2, a3) {
 try {
  return Module["dynCall_fiff"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fifi(index, a1, a2, a3) {
 try {
  return Module["dynCall_fifi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiiiiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiiiiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20) {
 try {
  Module["dynCall_vifiiiiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
 try {
  Module["dynCall_viiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fff(index, a1, a2) {
 try {
  return Module["dynCall_fff"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iidi(index, a1, a2, a3) {
 try {
  return Module["dynCall_iidi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vff(index, a1, a2) {
 try {
  Module["dynCall_vff"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiiiiifiiiiiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14) {
 try {
  return Module["dynCall_fiiiiiifiiiiiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiif(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  return Module["dynCall_iiiiifiif"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiiifii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiffi(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  Module["dynCall_viiiiiffi"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vfff(index, a1, a2, a3) {
 try {
  Module["dynCall_vfff"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifiiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viifiiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  return Module["dynCall_iiiiifiii"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiffi(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iiffi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vidd(index, a1, a2, a3) {
 try {
  Module["dynCall_vidd"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
 try {
  return Module["dynCall_iiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iidiii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iidiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fif(index, a1, a2) {
 try {
  return Module["dynCall_fif"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viifiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fii(index, a1, a2) {
 try {
  return Module["dynCall_fii"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiifiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
 try {
  Module["dynCall_viiiiiifiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiifii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  Module["dynCall_viiiiifii"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_di(index, a1) {
 try {
  return Module["dynCall_di"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viff(index, a1, a2, a3) {
 try {
  Module["dynCall_viff"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiifiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiifiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiifi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiiiifi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffff(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viffff"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_didiii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_didiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiffiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiffiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_dii(index, a1, a2) {
 try {
  return Module["dynCall_dii"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iifii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iifii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_didi(index, a1, a2, a3) {
 try {
  return Module["dynCall_didi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iiiii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iidii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iidii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiiiffffii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17) {
 try {
  return Module["dynCall_iiiiiiiiiiiiffffii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vdd(index, a1, a2) {
 try {
  Module["dynCall_vdd"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiifii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_fiiifii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffii(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viffii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15) {
 try {
  Module["dynCall_viiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_difi(index, a1, a2, a3) {
 try {
  return Module["dynCall_difi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vdddddd(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_vdddddd"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15) {
 try {
  Module["dynCall_vifiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32, a33, a34) {
 try {
  Module["dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30, a31, a32, a33, a34);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiifii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viiifii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiif(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiiiiif"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiffii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viiffii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  return Module["dynCall_iiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiffi(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_fiffi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiifii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiifii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17) {
 try {
  Module["dynCall_viiiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vffffffi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_vffffffi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13) {
 try {
  return Module["dynCall_iiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30) {
 try {
  Module["dynCall_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25, a26, a27, a28, a29, a30);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffi(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viffi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiifiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiiifiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiifiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  return Module["dynCall_iiiifiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifi(index, a1, a2, a3) {
 try {
  Module["dynCall_vifi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifff(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_vifff"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viiiiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14) {
 try {
  Module["dynCall_viiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiii(index, a1, a2, a3) {
 try {
  return Module["dynCall_fiii"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiifffiiifii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14) {
 try {
  return Module["dynCall_iiiiiifffiiifii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iifff(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iifff"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iifiii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iifiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiif(index, a1, a2, a3) {
 try {
  return Module["dynCall_fiif"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiiiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
 try {
  return Module["dynCall_iiiiifiiiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fifffffi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_fifffffi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
 try {
  Module["dynCall_viiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiffiiiiiiiiiffffiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23) {
 try {
  return Module["dynCall_iiiiiiffiiiiiiiiiffffiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_diii(index, a1, a2, a3) {
 try {
  return Module["dynCall_diii"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiffifi(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_fiffifi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiffi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiiffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiififi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiififi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_fiiii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiiiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiifii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiiifii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiffi(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiiiffi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiffii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
 try {
  Module["dynCall_viiiiiiffii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viidii(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viidii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiififi(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  Module["dynCall_viiiififi"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiifiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  return Module["dynCall_iiiiiifiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiii(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viiii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiii(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viiiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifii(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viifii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iifffi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iifffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vif(index, a1, a2) {
 try {
  Module["dynCall_vif"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vid(index, a1, a2) {
 try {
  Module["dynCall_vid"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vii(index, a1, a2) {
 try {
  Module["dynCall_vii"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  return Module["dynCall_iiiiifiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiffiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiffiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fi(index, a1) {
 try {
  return Module["dynCall_fi"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viidi(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viidi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifif(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viifif"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vf(index, a1) {
 try {
  Module["dynCall_vf"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiffiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22) {
 try {
  return Module["dynCall_iiiiiiffiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiiiiiiifiiiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14) {
 try {
  return Module["dynCall_fiiiiiiiifiiiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiffii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiffii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiffffffi(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiffffffi"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffffii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viffffii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiii(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_vifiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_diiii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_diiii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiifiiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiifiiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13) {
 try {
  Module["dynCall_viiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffffffii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viffffffii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiffffii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15) {
 try {
  return Module["dynCall_iiiiiiiiiiffffii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifi(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiiiifi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiffi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiiiffi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fifii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_fifii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  Module["dynCall_viiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiffifffi(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  return Module["dynCall_fiffifffi"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iif(index, a1, a2) {
 try {
  return Module["dynCall_iif"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_didii(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_didii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  Module["dynCall_viiiiiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifii(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_vifii"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iii(index, a1, a2) {
 try {
  return Module["dynCall_iii"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiiif(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_fiiiif"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiifii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiiifii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_f(index) {
 try {
  return Module["dynCall_f"](index);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vffff(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_vffff"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiifi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiiiifi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiifiiiiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
 try {
  Module["dynCall_viiiifiiiiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viififi(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viififi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viii(index, a1, a2, a3) {
 try {
  Module["dynCall_viii"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiifi(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viiiifi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_v(index) {
 try {
  Module["dynCall_v"](index);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viif(index, a1, a2, a3) {
 try {
  Module["dynCall_viif"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiifi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_fiiifi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiifi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiiifi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vd(index, a1) {
 try {
  Module["dynCall_vd"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiifi(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_fiifi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vi(index, a1) {
 try {
  Module["dynCall_vi"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10) {
 try {
  return Module["dynCall_iiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiffiiiiiiiiiffffiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25) {
 try {
  return Module["dynCall_iiiiiiiffiiiiiiiiiffffiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_ii(index, a1) {
 try {
  return Module["dynCall_ii"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifffi(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_vifffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifi(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viifi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
 try {
  return Module["dynCall_iiiiifiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiifiiiiif(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11) {
 try {
  return Module["dynCall_iiiiifiiiiif"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiff(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viiff"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12) {
 try {
  Module["dynCall_viiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iifi(index, a1, a2, a3) {
 try {
  return Module["dynCall_iifi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiif(index, a1, a2, a3, a4) {
 try {
  Module["dynCall_viiif"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fifffi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_fifffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiiiiiiiiiiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25) {
 try {
  Module["dynCall_vifiiiiiiiiiiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24, a25);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiffii(index, a1, a2, a3, a4, a5, a6) {
 try {
  return Module["dynCall_iiiffii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiifi(index, a1, a2, a3, a4) {
 try {
  return Module["dynCall_iiifi"](index, a1, a2, a3, a4);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiii(index, a1, a2, a3) {
 try {
  return Module["dynCall_iiii"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fidi(index, a1, a2, a3) {
 try {
  return Module["dynCall_fidi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifff(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viifff"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiffi(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viiffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiif(index, a1, a2, a3) {
 try {
  return Module["dynCall_iiif"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiffi(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viiiffi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_diiiii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_diiiii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiififfi(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiiififfi"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiifi(index, a1, a2, a3, a4, a5) {
 try {
  Module["dynCall_viiifi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_fiiffi(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_fiiffi"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiffiiiiiiiiiffffiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24) {
 try {
  return Module["dynCall_iiiiiiffiiiiiiiiiffffiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14, a15, a16, a17, a18, a19, a20, a21, a22, a23, a24);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12) {
 try {
  return Module["dynCall_iiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viifffi(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viifffi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifffii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_vifffii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiifiii(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiiifiii"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_ff(index, a1) {
 try {
  return Module["dynCall_ff"](index, a1);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiifiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  return Module["dynCall_iiiifiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14) {
 try {
  return Module["dynCall_iiiiiiiiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9, a10, a11, a12, a13, a14);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiififfi(index, a1, a2, a3, a4, a5, a6, a7) {
 try {
  return Module["dynCall_iiififfi"](index, a1, a2, a3, a4, a5, a6, a7);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vfi(index, a1, a2) {
 try {
  Module["dynCall_vfi"](index, a1, a2);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_i(index) {
 try {
  return Module["dynCall_i"](index);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiidii(index, a1, a2, a3, a4, a5) {
 try {
  return Module["dynCall_iiidii"](index, a1, a2, a3, a4, a5);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiifiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiifiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viiiiifffi(index, a1, a2, a3, a4, a5, a6, a7, a8, a9) {
 try {
  Module["dynCall_viiiiifffi"](index, a1, a2, a3, a4, a5, a6, a7, a8, a9);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vidi(index, a1, a2, a3) {
 try {
  Module["dynCall_vidi"](index, a1, a2, a3);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_iiiiiiiii(index, a1, a2, a3, a4, a5, a6, a7, a8) {
 try {
  return Module["dynCall_iiiiiiiii"](index, a1, a2, a3, a4, a5, a6, a7, a8);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_vifiiii(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_vifiiii"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
function invoke_viffffi(index, a1, a2, a3, a4, a5, a6) {
 try {
  Module["dynCall_viffffi"](index, a1, a2, a3, a4, a5, a6);
 } catch (e) {
  if (typeof e !== "number" && e !== "longjmp") throw e;
  asm["setThrew"](1, 0);
 }
}
Module.asmGlobalArg = {
 "Math": Math,
 "Int8Array": Int8Array,
 "Int16Array": Int16Array,
 "Int32Array": Int32Array,
 "Uint8Array": Uint8Array,
 "Uint16Array": Uint16Array,
 "Uint32Array": Uint32Array,
 "Float32Array": Float32Array,
 "Float64Array": Float64Array,
 "NaN": NaN,
 "Infinity": Infinity
};
Module.asmLibraryArg = {
 "abort": abort,
 "assert": assert,
 "enlargeMemory": enlargeMemory,
 "getTotalMemory": getTotalMemory,
 "abortOnCannotGrowMemory": abortOnCannotGrowMemory,
 "abortStackOverflow": abortStackOverflow,
 "nullFunc_viiifiii": nullFunc_viiifiii,
 "nullFunc_diddi": nullFunc_diddi,
 "nullFunc_fiff": nullFunc_fiff,
 "nullFunc_fifi": nullFunc_fifi,
 "nullFunc_iiiiiii": nullFunc_iiiiiii,
 "nullFunc_vifiiiiiiiiiiiiiiiiii": nullFunc_vifiiiiiiiiiiiiiiiiii,
 "nullFunc_viiiiiiiiiii": nullFunc_viiiiiiiiiii,
 "nullFunc_fff": nullFunc_fff,
 "nullFunc_iidi": nullFunc_iidi,
 "nullFunc_vff": nullFunc_vff,
 "nullFunc_fiiiiiifiiiiiif": nullFunc_fiiiiiifiiiiiif,
 "nullFunc_iiiiifiif": nullFunc_iiiiifiif,
 "nullFunc_iiiiifii": nullFunc_iiiiifii,
 "nullFunc_viiiiiffi": nullFunc_viiiiiffi,
 "nullFunc_vfff": nullFunc_vfff,
 "nullFunc_viifiiii": nullFunc_viifiiii,
 "nullFunc_iiiiifiii": nullFunc_iiiiifiii,
 "nullFunc_iiffi": nullFunc_iiffi,
 "nullFunc_vidd": nullFunc_vidd,
 "nullFunc_iiiiiiiiiiii": nullFunc_iiiiiiiiiiii,
 "nullFunc_iidiii": nullFunc_iidiii,
 "nullFunc_fif": nullFunc_fif,
 "nullFunc_viifiii": nullFunc_viifiii,
 "nullFunc_fii": nullFunc_fii,
 "nullFunc_viiiiiifiii": nullFunc_viiiiiifiii,
 "nullFunc_viiiiifii": nullFunc_viiiiifii,
 "nullFunc_di": nullFunc_di,
 "nullFunc_viff": nullFunc_viff,
 "nullFunc_iiifiii": nullFunc_iiifiii,
 "nullFunc_viiiiifi": nullFunc_viiiiifi,
 "nullFunc_viffff": nullFunc_viffff,
 "nullFunc_didiii": nullFunc_didiii,
 "nullFunc_viiffiii": nullFunc_viiffiii,
 "nullFunc_dii": nullFunc_dii,
 "nullFunc_iifii": nullFunc_iifii,
 "nullFunc_didi": nullFunc_didi,
 "nullFunc_iiiii": nullFunc_iiiii,
 "nullFunc_iidii": nullFunc_iidii,
 "nullFunc_iiiiiiiiiiiiffffii": nullFunc_iiiiiiiiiiiiffffii,
 "nullFunc_vdd": nullFunc_vdd,
 "nullFunc_fiiifii": nullFunc_fiiifii,
 "nullFunc_viffii": nullFunc_viffii,
 "nullFunc_iiiiiiii": nullFunc_iiiiiiii,
 "nullFunc_viiiiiiiiiiiiiii": nullFunc_viiiiiiiiiiiiiii,
 "nullFunc_difi": nullFunc_difi,
 "nullFunc_vdddddd": nullFunc_vdddddd,
 "nullFunc_vifiiiiiiiiiiiii": nullFunc_vifiiiiiiiiiiiii,
 "nullFunc_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii": nullFunc_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii,
 "nullFunc_viiifii": nullFunc_viiifii,
 "nullFunc_iiiiiiif": nullFunc_iiiiiiif,
 "nullFunc_viiffii": nullFunc_viiffii,
 "nullFunc_iiiiiiiiii": nullFunc_iiiiiiiiii,
 "nullFunc_fiffi": nullFunc_fiffi,
 "nullFunc_iiifii": nullFunc_iiifii,
 "nullFunc_viiiiiiiiiiiiiiiii": nullFunc_viiiiiiiiiiiiiiiii,
 "nullFunc_vffffffi": nullFunc_vffffffi,
 "nullFunc_iiiiiiiiiiiiii": nullFunc_iiiiiiiiiiiiii,
 "nullFunc_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii": nullFunc_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii,
 "nullFunc_viffi": nullFunc_viffi,
 "nullFunc_viiiifiiii": nullFunc_viiiifiiii,
 "nullFunc_iiiifiiii": nullFunc_iiiifiiii,
 "nullFunc_vifi": nullFunc_vifi,
 "nullFunc_vifff": nullFunc_vifff,
 "nullFunc_viiiiii": nullFunc_viiiiii,
 "nullFunc_viiiiiiiiiiiiii": nullFunc_viiiiiiiiiiiiii,
 "nullFunc_fiii": nullFunc_fiii,
 "nullFunc_iiiiiifffiiifii": nullFunc_iiiiiifffiiifii,
 "nullFunc_iifff": nullFunc_iifff,
 "nullFunc_iifiii": nullFunc_iifiii,
 "nullFunc_fiif": nullFunc_fiif,
 "nullFunc_iiiiifiiiif": nullFunc_iiiiifiiiif,
 "nullFunc_fifffffi": nullFunc_fifffffi,
 "nullFunc_viiiiiiiiii": nullFunc_viiiiiiiiii,
 "nullFunc_iiiiiiffiiiiiiiiiffffiii": nullFunc_iiiiiiffiiiiiiiiiffffiii,
 "nullFunc_diii": nullFunc_diii,
 "nullFunc_fiffifi": nullFunc_fiffifi,
 "nullFunc_iiiffi": nullFunc_iiiffi,
 "nullFunc_viiififi": nullFunc_viiififi,
 "nullFunc_fiiii": nullFunc_fiiii,
 "nullFunc_iiiiii": nullFunc_iiiiii,
 "nullFunc_viiiifii": nullFunc_viiiifii,
 "nullFunc_iiiiffi": nullFunc_iiiiffi,
 "nullFunc_viiiiiiffii": nullFunc_viiiiiiffii,
 "nullFunc_viidii": nullFunc_viidii,
 "nullFunc_viiiififi": nullFunc_viiiififi,
 "nullFunc_iiiiiifiif": nullFunc_iiiiiifiif,
 "nullFunc_viiii": nullFunc_viiii,
 "nullFunc_viiiii": nullFunc_viiiii,
 "nullFunc_viifii": nullFunc_viifii,
 "nullFunc_iifffi": nullFunc_iifffi,
 "nullFunc_vif": nullFunc_vif,
 "nullFunc_vid": nullFunc_vid,
 "nullFunc_vii": nullFunc_vii,
 "nullFunc_iiiiifiiii": nullFunc_iiiiifiiii,
 "nullFunc_iiffiii": nullFunc_iiffiii,
 "nullFunc_fi": nullFunc_fi,
 "nullFunc_viidi": nullFunc_viidi,
 "nullFunc_viifif": nullFunc_viifif,
 "nullFunc_vf": nullFunc_vf,
 "nullFunc_iiiiiiffiiiiiiiiiiiiiii": nullFunc_iiiiiiffiiiiiiiiiiiiiii,
 "nullFunc_fiiiiiiiifiiiif": nullFunc_fiiiiiiiifiiiif,
 "nullFunc_iiffii": nullFunc_iiffii,
 "nullFunc_viiffffffi": nullFunc_viiffffffi,
 "nullFunc_viffffii": nullFunc_viffffii,
 "nullFunc_vifiii": nullFunc_vifiii,
 "nullFunc_diiii": nullFunc_diiii,
 "nullFunc_iiifiiii": nullFunc_iiifiiii,
 "nullFunc_viiiiiiiiiiiii": nullFunc_viiiiiiiiiiiii,
 "nullFunc_viffffffii": nullFunc_viffffffii,
 "nullFunc_iiiiiiiiiiffffii": nullFunc_iiiiiiiiiiffffii,
 "nullFunc_iiiiifi": nullFunc_iiiiifi,
 "nullFunc_iiiiiffi": nullFunc_iiiiiffi,
 "nullFunc_fifii": nullFunc_fifii,
 "nullFunc_viiiiiiii": nullFunc_viiiiiiii,
 "nullFunc_fiffifffi": nullFunc_fiffifffi,
 "nullFunc_iif": nullFunc_iif,
 "nullFunc_didii": nullFunc_didii,
 "nullFunc_viiiiiii": nullFunc_viiiiiii,
 "nullFunc_vifii": nullFunc_vifii,
 "nullFunc_viiiiiiiii": nullFunc_viiiiiiiii,
 "nullFunc_iii": nullFunc_iii,
 "nullFunc_fiiiif": nullFunc_fiiiif,
 "nullFunc_iiiifii": nullFunc_iiiifii,
 "nullFunc_f": nullFunc_f,
 "nullFunc_vffff": nullFunc_vffff,
 "nullFunc_iiiiiifi": nullFunc_iiiiiifi,
 "nullFunc_viiiifiiiiif": nullFunc_viiiifiiiiif,
 "nullFunc_viififi": nullFunc_viififi,
 "nullFunc_viii": nullFunc_viii,
 "nullFunc_viiiifi": nullFunc_viiiifi,
 "nullFunc_v": nullFunc_v,
 "nullFunc_viif": nullFunc_viif,
 "nullFunc_fiiifi": nullFunc_fiiifi,
 "nullFunc_iiiifi": nullFunc_iiiifi,
 "nullFunc_vd": nullFunc_vd,
 "nullFunc_fiifi": nullFunc_fiifi,
 "nullFunc_vi": nullFunc_vi,
 "nullFunc_iiiiiiiiiii": nullFunc_iiiiiiiiiii,
 "nullFunc_iiiiiiiffiiiiiiiiiffffiiii": nullFunc_iiiiiiiffiiiiiiiiiffffiiii,
 "nullFunc_ii": nullFunc_ii,
 "nullFunc_vifffi": nullFunc_vifffi,
 "nullFunc_viifi": nullFunc_viifi,
 "nullFunc_iiiiifiiiiii": nullFunc_iiiiifiiiiii,
 "nullFunc_iiiiifiiiiif": nullFunc_iiiiifiiiiif,
 "nullFunc_viiff": nullFunc_viiff,
 "nullFunc_viiiiiiiiiiii": nullFunc_viiiiiiiiiiii,
 "nullFunc_iifi": nullFunc_iifi,
 "nullFunc_viiif": nullFunc_viiif,
 "nullFunc_fifffi": nullFunc_fifffi,
 "nullFunc_vifiiiiiiiiiiiiiiiiiiiiiii": nullFunc_vifiiiiiiiiiiiiiiiiiiiiiii,
 "nullFunc_iiiffii": nullFunc_iiiffii,
 "nullFunc_iiifi": nullFunc_iiifi,
 "nullFunc_iiii": nullFunc_iiii,
 "nullFunc_fidi": nullFunc_fidi,
 "nullFunc_viifff": nullFunc_viifff,
 "nullFunc_viiffi": nullFunc_viiffi,
 "nullFunc_iiif": nullFunc_iiif,
 "nullFunc_viiiffi": nullFunc_viiiffi,
 "nullFunc_diiiii": nullFunc_diiiii,
 "nullFunc_viiiififfi": nullFunc_viiiififfi,
 "nullFunc_viiifi": nullFunc_viiifi,
 "nullFunc_fiiffi": nullFunc_fiiffi,
 "nullFunc_iiiiiiffiiiiiiiiiffffiiii": nullFunc_iiiiiiffiiiiiiiiiffffiiii,
 "nullFunc_iiiiiiiiiiiii": nullFunc_iiiiiiiiiiiii,
 "nullFunc_viifffi": nullFunc_viifffi,
 "nullFunc_vifffii": nullFunc_vifffii,
 "nullFunc_iiiifiii": nullFunc_iiiifiii,
 "nullFunc_ff": nullFunc_ff,
 "nullFunc_iiiifiiiii": nullFunc_iiiifiiiii,
 "nullFunc_iiiiiiiiiiiiiii": nullFunc_iiiiiiiiiiiiiii,
 "nullFunc_iiififfi": nullFunc_iiififfi,
 "nullFunc_vfi": nullFunc_vfi,
 "nullFunc_i": nullFunc_i,
 "nullFunc_iiidii": nullFunc_iiidii,
 "nullFunc_viiifiiiii": nullFunc_viiifiiiii,
 "nullFunc_viiiiifffi": nullFunc_viiiiifffi,
 "nullFunc_vidi": nullFunc_vidi,
 "nullFunc_iiiiiiiii": nullFunc_iiiiiiiii,
 "nullFunc_vifiiii": nullFunc_vifiiii,
 "nullFunc_viffffi": nullFunc_viffffi,
 "invoke_viiifiii": invoke_viiifiii,
 "invoke_diddi": invoke_diddi,
 "invoke_fiff": invoke_fiff,
 "invoke_fifi": invoke_fifi,
 "invoke_iiiiiii": invoke_iiiiiii,
 "invoke_vifiiiiiiiiiiiiiiiiii": invoke_vifiiiiiiiiiiiiiiiiii,
 "invoke_viiiiiiiiiii": invoke_viiiiiiiiiii,
 "invoke_fff": invoke_fff,
 "invoke_iidi": invoke_iidi,
 "invoke_vff": invoke_vff,
 "invoke_fiiiiiifiiiiiif": invoke_fiiiiiifiiiiiif,
 "invoke_iiiiifiif": invoke_iiiiifiif,
 "invoke_iiiiifii": invoke_iiiiifii,
 "invoke_viiiiiffi": invoke_viiiiiffi,
 "invoke_vfff": invoke_vfff,
 "invoke_viifiiii": invoke_viifiiii,
 "invoke_iiiiifiii": invoke_iiiiifiii,
 "invoke_iiffi": invoke_iiffi,
 "invoke_vidd": invoke_vidd,
 "invoke_iiiiiiiiiiii": invoke_iiiiiiiiiiii,
 "invoke_iidiii": invoke_iidiii,
 "invoke_fif": invoke_fif,
 "invoke_viifiii": invoke_viifiii,
 "invoke_fii": invoke_fii,
 "invoke_viiiiiifiii": invoke_viiiiiifiii,
 "invoke_viiiiifii": invoke_viiiiifii,
 "invoke_di": invoke_di,
 "invoke_viff": invoke_viff,
 "invoke_iiifiii": invoke_iiifiii,
 "invoke_viiiiifi": invoke_viiiiifi,
 "invoke_viffff": invoke_viffff,
 "invoke_didiii": invoke_didiii,
 "invoke_viiffiii": invoke_viiffiii,
 "invoke_dii": invoke_dii,
 "invoke_iifii": invoke_iifii,
 "invoke_didi": invoke_didi,
 "invoke_iiiii": invoke_iiiii,
 "invoke_iidii": invoke_iidii,
 "invoke_iiiiiiiiiiiiffffii": invoke_iiiiiiiiiiiiffffii,
 "invoke_vdd": invoke_vdd,
 "invoke_fiiifii": invoke_fiiifii,
 "invoke_viffii": invoke_viffii,
 "invoke_iiiiiiii": invoke_iiiiiiii,
 "invoke_viiiiiiiiiiiiiii": invoke_viiiiiiiiiiiiiii,
 "invoke_difi": invoke_difi,
 "invoke_vdddddd": invoke_vdddddd,
 "invoke_vifiiiiiiiiiiiii": invoke_vifiiiiiiiiiiiii,
 "invoke_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii": invoke_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii,
 "invoke_viiifii": invoke_viiifii,
 "invoke_iiiiiiif": invoke_iiiiiiif,
 "invoke_viiffii": invoke_viiffii,
 "invoke_iiiiiiiiii": invoke_iiiiiiiiii,
 "invoke_fiffi": invoke_fiffi,
 "invoke_iiifii": invoke_iiifii,
 "invoke_viiiiiiiiiiiiiiiii": invoke_viiiiiiiiiiiiiiiii,
 "invoke_vffffffi": invoke_vffffffi,
 "invoke_iiiiiiiiiiiiii": invoke_iiiiiiiiiiiiii,
 "invoke_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii": invoke_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii,
 "invoke_viffi": invoke_viffi,
 "invoke_viiiifiiii": invoke_viiiifiiii,
 "invoke_iiiifiiii": invoke_iiiifiiii,
 "invoke_vifi": invoke_vifi,
 "invoke_vifff": invoke_vifff,
 "invoke_viiiiii": invoke_viiiiii,
 "invoke_viiiiiiiiiiiiii": invoke_viiiiiiiiiiiiii,
 "invoke_fiii": invoke_fiii,
 "invoke_iiiiiifffiiifii": invoke_iiiiiifffiiifii,
 "invoke_iifff": invoke_iifff,
 "invoke_iifiii": invoke_iifiii,
 "invoke_fiif": invoke_fiif,
 "invoke_iiiiifiiiif": invoke_iiiiifiiiif,
 "invoke_fifffffi": invoke_fifffffi,
 "invoke_viiiiiiiiii": invoke_viiiiiiiiii,
 "invoke_iiiiiiffiiiiiiiiiffffiii": invoke_iiiiiiffiiiiiiiiiffffiii,
 "invoke_diii": invoke_diii,
 "invoke_fiffifi": invoke_fiffifi,
 "invoke_iiiffi": invoke_iiiffi,
 "invoke_viiififi": invoke_viiififi,
 "invoke_fiiii": invoke_fiiii,
 "invoke_iiiiii": invoke_iiiiii,
 "invoke_viiiifii": invoke_viiiifii,
 "invoke_iiiiffi": invoke_iiiiffi,
 "invoke_viiiiiiffii": invoke_viiiiiiffii,
 "invoke_viidii": invoke_viidii,
 "invoke_viiiififi": invoke_viiiififi,
 "invoke_iiiiiifiif": invoke_iiiiiifiif,
 "invoke_viiii": invoke_viiii,
 "invoke_viiiii": invoke_viiiii,
 "invoke_viifii": invoke_viifii,
 "invoke_iifffi": invoke_iifffi,
 "invoke_vif": invoke_vif,
 "invoke_vid": invoke_vid,
 "invoke_vii": invoke_vii,
 "invoke_iiiiifiiii": invoke_iiiiifiiii,
 "invoke_iiffiii": invoke_iiffiii,
 "invoke_fi": invoke_fi,
 "invoke_viidi": invoke_viidi,
 "invoke_viifif": invoke_viifif,
 "invoke_vf": invoke_vf,
 "invoke_iiiiiiffiiiiiiiiiiiiiii": invoke_iiiiiiffiiiiiiiiiiiiiii,
 "invoke_fiiiiiiiifiiiif": invoke_fiiiiiiiifiiiif,
 "invoke_iiffii": invoke_iiffii,
 "invoke_viiffffffi": invoke_viiffffffi,
 "invoke_viffffii": invoke_viffffii,
 "invoke_vifiii": invoke_vifiii,
 "invoke_diiii": invoke_diiii,
 "invoke_iiifiiii": invoke_iiifiiii,
 "invoke_viiiiiiiiiiiii": invoke_viiiiiiiiiiiii,
 "invoke_viffffffii": invoke_viffffffii,
 "invoke_iiiiiiiiiiffffii": invoke_iiiiiiiiiiffffii,
 "invoke_iiiiifi": invoke_iiiiifi,
 "invoke_iiiiiffi": invoke_iiiiiffi,
 "invoke_fifii": invoke_fifii,
 "invoke_viiiiiiii": invoke_viiiiiiii,
 "invoke_fiffifffi": invoke_fiffifffi,
 "invoke_iif": invoke_iif,
 "invoke_didii": invoke_didii,
 "invoke_viiiiiii": invoke_viiiiiii,
 "invoke_vifii": invoke_vifii,
 "invoke_viiiiiiiii": invoke_viiiiiiiii,
 "invoke_iii": invoke_iii,
 "invoke_fiiiif": invoke_fiiiif,
 "invoke_iiiifii": invoke_iiiifii,
 "invoke_f": invoke_f,
 "invoke_vffff": invoke_vffff,
 "invoke_iiiiiifi": invoke_iiiiiifi,
 "invoke_viiiifiiiiif": invoke_viiiifiiiiif,
 "invoke_viififi": invoke_viififi,
 "invoke_viii": invoke_viii,
 "invoke_viiiifi": invoke_viiiifi,
 "invoke_v": invoke_v,
 "invoke_viif": invoke_viif,
 "invoke_fiiifi": invoke_fiiifi,
 "invoke_iiiifi": invoke_iiiifi,
 "invoke_vd": invoke_vd,
 "invoke_fiifi": invoke_fiifi,
 "invoke_vi": invoke_vi,
 "invoke_iiiiiiiiiii": invoke_iiiiiiiiiii,
 "invoke_iiiiiiiffiiiiiiiiiffffiiii": invoke_iiiiiiiffiiiiiiiiiffffiiii,
 "invoke_ii": invoke_ii,
 "invoke_vifffi": invoke_vifffi,
 "invoke_viifi": invoke_viifi,
 "invoke_iiiiifiiiiii": invoke_iiiiifiiiiii,
 "invoke_iiiiifiiiiif": invoke_iiiiifiiiiif,
 "invoke_viiff": invoke_viiff,
 "invoke_viiiiiiiiiiii": invoke_viiiiiiiiiiii,
 "invoke_iifi": invoke_iifi,
 "invoke_viiif": invoke_viiif,
 "invoke_fifffi": invoke_fifffi,
 "invoke_vifiiiiiiiiiiiiiiiiiiiiiii": invoke_vifiiiiiiiiiiiiiiiiiiiiiii,
 "invoke_iiiffii": invoke_iiiffii,
 "invoke_iiifi": invoke_iiifi,
 "invoke_iiii": invoke_iiii,
 "invoke_fidi": invoke_fidi,
 "invoke_viifff": invoke_viifff,
 "invoke_viiffi": invoke_viiffi,
 "invoke_iiif": invoke_iiif,
 "invoke_viiiffi": invoke_viiiffi,
 "invoke_diiiii": invoke_diiiii,
 "invoke_viiiififfi": invoke_viiiififfi,
 "invoke_viiifi": invoke_viiifi,
 "invoke_fiiffi": invoke_fiiffi,
 "invoke_iiiiiiffiiiiiiiiiffffiiii": invoke_iiiiiiffiiiiiiiiiffffiiii,
 "invoke_iiiiiiiiiiiii": invoke_iiiiiiiiiiiii,
 "invoke_viifffi": invoke_viifffi,
 "invoke_vifffii": invoke_vifffii,
 "invoke_iiiifiii": invoke_iiiifiii,
 "invoke_ff": invoke_ff,
 "invoke_iiiifiiiii": invoke_iiiifiiiii,
 "invoke_iiiiiiiiiiiiiii": invoke_iiiiiiiiiiiiiii,
 "invoke_iiififfi": invoke_iiififfi,
 "invoke_vfi": invoke_vfi,
 "invoke_i": invoke_i,
 "invoke_iiidii": invoke_iiidii,
 "invoke_viiifiiiii": invoke_viiifiiiii,
 "invoke_viiiiifffi": invoke_viiiiifffi,
 "invoke_vidi": invoke_vidi,
 "invoke_iiiiiiiii": invoke_iiiiiiiii,
 "invoke_vifiiii": invoke_vifiiii,
 "invoke_viffffi": invoke_viffffi,
 "_emscripten_glGetTexParameterfv": _emscripten_glGetTexParameterfv,
 "_glClearStencil": _glClearStencil,
 "__inet_ntop6_raw": __inet_ntop6_raw,
 "___syscall220": ___syscall220,
 "_emscripten_glBlendFuncSeparate": _emscripten_glBlendFuncSeparate,
 "_glTexParameteriv": _glTexParameteriv,
 "_glUniformMatrix4fv": _glUniformMatrix4fv,
 "___assert_fail": ___assert_fail,
 "_glVertexAttrib4f": _glVertexAttrib4f,
 "_emscripten_glDepthFunc": _emscripten_glDepthFunc,
 "_emscripten_webgl_create_context": _emscripten_webgl_create_context,
 "_pthread_key_delete": _pthread_key_delete,
 "_glDisableVertexAttribArray": _glDisableVertexAttribArray,
 "_emscripten_memcpy_big": _emscripten_memcpy_big,
 "_pthread_attr_init": _pthread_attr_init,
 "_glRenderbufferStorageMultisample": _glRenderbufferStorageMultisample,
 "emscriptenWebGLComputeImageSize": emscriptenWebGLComputeImageSize,
 "___syscall221": ___syscall221,
 "_glInvalidateFramebuffer": _glInvalidateFramebuffer,
 "_emscripten_glVertexAttrib2f": _emscripten_glVertexAttrib2f,
 "_emscripten_glUniform1i": _emscripten_glUniform1i,
 "_emscripten_glGetIntegerv": _emscripten_glGetIntegerv,
 "_emscripten_glIsProgram": _emscripten_glIsProgram,
 "_glGenSamplers": _glGenSamplers,
 "_emscripten_webgl_make_context_current": _emscripten_webgl_make_context_current,
 "_glEndTransformFeedback": _glEndTransformFeedback,
 "_glFramebufferRenderbuffer": _glFramebufferRenderbuffer,
 "_gmtime_r": _gmtime_r,
 "___cxa_rethrow": ___cxa_rethrow,
 "_emscripten_glTexParameteriv": _emscripten_glTexParameteriv,
 "___syscall140": ___syscall140,
 "___syscall142": ___syscall142,
 "___syscall145": ___syscall145,
 "___syscall146": ___syscall146,
 "_glUniform1uiv": _glUniform1uiv,
 "_emscripten_glAttachShader": _emscripten_glAttachShader,
 "_emscripten_get_now_is_monotonic": _emscripten_get_now_is_monotonic,
 "_pthread_cond_timedwait": _pthread_cond_timedwait,
 "_emscripten_glTexParameterfv": _emscripten_glTexParameterfv,
 "_pthread_attr_destroy": _pthread_attr_destroy,
 "_emscripten_glUniformMatrix2fv": _emscripten_glUniformMatrix2fv,
 "_SDL_GetTicks": _SDL_GetTicks,
 "_emscripten_glDrawArraysInstanced": _emscripten_glDrawArraysInstanced,
 "_JS_UNETWebSockets_IsHostReadyToConnect": _JS_UNETWebSockets_IsHostReadyToConnect,
 "_glDepthMask": _glDepthMask,
 "_emscripten_glVertexAttrib2fv": _emscripten_glVertexAttrib2fv,
 "_glViewport": _glViewport,
 "_emscripten_glFlush": _emscripten_glFlush,
 "_glReadBuffer": _glReadBuffer,
 "___syscall91": ___syscall91,
 "_pthread_once": _pthread_once,
 "_glDrawArraysInstanced": _glDrawArraysInstanced,
 "_JS_Sound_SetListenerOrientation": _JS_Sound_SetListenerOrientation,
 "_emscripten_glGetAttribLocation": _emscripten_glGetAttribLocation,
 "_glBeginQuery": _glBeginQuery,
 "_glAttachShader": _glAttachShader,
 "_emscripten_glTexCoordPointer": _emscripten_glTexCoordPointer,
 "_emscripten_set_blur_callback": _emscripten_set_blur_callback,
 "_emscripten_glLoadMatrixf": _emscripten_glLoadMatrixf,
 "_emscripten_glStencilFuncSeparate": _emscripten_glStencilFuncSeparate,
 "_emscripten_glVertexAttrib3f": _emscripten_glVertexAttrib3f,
 "_emscripten_webgl_enable_extension": _emscripten_webgl_enable_extension,
 "_glCullFace": _glCullFace,
 "_emscripten_get_gamepad_status": _emscripten_get_gamepad_status,
 "_sched_yield": _sched_yield,
 "_JS_Eval_OpenURL": _JS_Eval_OpenURL,
 "_inet_addr": _inet_addr,
 "_glCompressedTexImage2D": _glCompressedTexImage2D,
 "_emscripten_glUniform1iv": _emscripten_glUniform1iv,
 "emscriptenWebGLGetUniform": emscriptenWebGLGetUniform,
 "_glClearColor": _glClearColor,
 "_glFinish": _glFinish,
 "_emscripten_glUniform3iv": _emscripten_glUniform3iv,
 "_emscripten_glGetBufferParameteriv": _emscripten_glGetBufferParameteriv,
 "_emscripten_glVertexAttrib4fv": _emscripten_glVertexAttrib4fv,
 "_glGetTexParameteriv": _glGetTexParameteriv,
 "_pthread_getspecific": _pthread_getspecific,
 "_glDrawArrays": _glDrawArrays,
 "_glGetError": _glGetError,
 "_emscripten_glDepthRange": _emscripten_glDepthRange,
 "_glActiveTexture": _glActiveTexture,
 "_emscripten_asm_const_iii": _emscripten_asm_const_iii,
 "_emscripten_glCopyTexImage2D": _emscripten_glCopyTexImage2D,
 "_emscripten_glFramebufferTexture2D": _emscripten_glFramebufferTexture2D,
 "_glEnableVertexAttribArray": _glEnableVertexAttribArray,
 "_emscripten_glStencilFunc": _emscripten_glStencilFunc,
 "_glBindVertexArray": _glBindVertexArray,
 "_glVertexAttribIPointer": _glVertexAttribIPointer,
 "_glDeleteBuffers": _glDeleteBuffers,
 "_localtime": _localtime,
 "_glGetUniformBlockIndex": _glGetUniformBlockIndex,
 "_glGetActiveUniformBlockName": _glGetActiveUniformBlockName,
 "_JS_UNETWebSockets_SocketRecvEvntTypeFromHost": _JS_UNETWebSockets_SocketRecvEvntTypeFromHost,
 "_emscripten_glUniform1f": _emscripten_glUniform1f,
 "_glCompressedTexSubImage2D": _glCompressedTexSubImage2D,
 "_emscripten_glRenderbufferStorage": _emscripten_glRenderbufferStorage,
 "_Mix_PlayMusic": _Mix_PlayMusic,
 "_emscripten_set_keydown_callback": _emscripten_set_keydown_callback,
 "_emscripten_glVertexPointer": _emscripten_glVertexPointer,
 "__read_sockaddr": __read_sockaddr,
 "_JS_SystemInfo_GetHeight": _JS_SystemInfo_GetHeight,
 "_emscripten_glBufferSubData": _emscripten_glBufferSubData,
 "_emscripten_glGetUniformfv": _emscripten_glGetUniformfv,
 "_SDL_FreeRW": _SDL_FreeRW,
 "_glFramebufferTextureLayer": _glFramebufferTextureLayer,
 "_glDeleteQueries": _glDeleteQueries,
 "_Mix_LoadWAV_RW": _Mix_LoadWAV_RW,
 "_emscripten_glStencilOp": _emscripten_glStencilOp,
 "_emscripten_glBlendEquation": _emscripten_glBlendEquation,
 "_glTexImage3D": _glTexImage3D,
 "emscriptenWebGLGetIndexed": emscriptenWebGLGetIndexed,
 "_emscripten_glVertexAttrib1fv": _emscripten_glVertexAttrib1fv,
 "_TTF_SizeText": _TTF_SizeText,
 "_emscripten_glDeleteBuffers": _emscripten_glDeleteBuffers,
 "_glLinkProgram": _glLinkProgram,
 "_emscripten_glGetProgramInfoLog": _emscripten_glGetProgramInfoLog,
 "_emscripten_glUniform4fv": _emscripten_glUniform4fv,
 "___cxa_throw": ___cxa_throw,
 "_JS_SystemInfo_GetCurrentCanvasWidth": _JS_SystemInfo_GetCurrentCanvasWidth,
 "_glUniform1iv": _glUniform1iv,
 "_emscripten_glUniform2fv": _emscripten_glUniform2fv,
 "_emscripten_glBindBuffer": _emscripten_glBindBuffer,
 "_emscripten_glGetFloatv": _emscripten_glGetFloatv,
 "_pthread_mutex_init": _pthread_mutex_init,
 "_glBlendEquationSeparate": _glBlendEquationSeparate,
 "_JS_UNETWebSockets_IsHostCorrect": _JS_UNETWebSockets_IsHostCorrect,
 "_glUseProgram": _glUseProgram,
 "_glUniformMatrix3fv": _glUniformMatrix3fv,
 "_emscripten_glCullFace": _emscripten_glCullFace,
 "_glBindTransformFeedback": _glBindTransformFeedback,
 "_emscripten_glStencilMaskSeparate": _emscripten_glStencilMaskSeparate,
 "_emscripten_glUniform3fv": _emscripten_glUniform3fv,
 "_glBindBuffer": _glBindBuffer,
 "_emscripten_request_fullscreen": _emscripten_request_fullscreen,
 "_JS_Sound_Play": _JS_Sound_Play,
 "_emscripten_asm_const_id": _emscripten_asm_const_id,
 "_emscripten_glDisableVertexAttribArray": _emscripten_glDisableVertexAttribArray,
 "_TTF_RenderText_Solid": _TTF_RenderText_Solid,
 "_glPolygonOffset": _glPolygonOffset,
 "_emscripten_webgl_get_current_context": _emscripten_webgl_get_current_context,
 "_JS_UNETWebSockets_SocketStop": _JS_UNETWebSockets_SocketStop,
 "_emscripten_set_touchstart_callback": _emscripten_set_touchstart_callback,
 "_JS_Sound_SetListenerPosition": _JS_Sound_SetListenerPosition,
 "_emscripten_glGetBooleanv": _emscripten_glGetBooleanv,
 "_glProgramBinary": _glProgramBinary,
 "_emscripten_glVertexAttribDivisor": _emscripten_glVertexAttribDivisor,
 "_JS_Profiler_InjectJobs": _JS_Profiler_InjectJobs,
 "_JS_Eval_SetTimeout": _JS_Eval_SetTimeout,
 "_glDrawElementsInstanced": _glDrawElementsInstanced,
 "_emscripten_glDeleteObjectARB": _emscripten_glDeleteObjectARB,
 "_emscripten_glUniform4f": _emscripten_glUniform4f,
 "_emscripten_glGetShaderPrecisionFormat": _emscripten_glGetShaderPrecisionFormat,
 "__write_sockaddr": __write_sockaddr,
 "_JS_SystemInfo_GetLanguage": _JS_SystemInfo_GetLanguage,
 "_emscripten_glIsEnabled": _emscripten_glIsEnabled,
 "_JS_SystemInfo_HasFullscreen": _JS_SystemInfo_HasFullscreen,
 "_emscripten_glStencilOpSeparate": _emscripten_glStencilOpSeparate,
 "_JS_Sound_Set3D": _JS_Sound_Set3D,
 "_pthread_cleanup_pop": _pthread_cleanup_pop,
 "_glGenerateMipmap": _glGenerateMipmap,
 "_JS_Sound_SetPosition": _JS_Sound_SetPosition,
 "___syscall122": ___syscall122,
 "___cxa_free_exception": ___cxa_free_exception,
 "___cxa_find_matching_catch": ___cxa_find_matching_catch,
 "_JS_SystemInfo_HasCursorLock": _JS_SystemInfo_HasCursorLock,
 "_emscripten_glClear": _emscripten_glClear,
 "_glDrawElements": _glDrawElements,
 "_JS_WebRequest_Send": _JS_WebRequest_Send,
 "_emscripten_glValidateProgram": _emscripten_glValidateProgram,
 "_emscripten_glUniform4iv": _emscripten_glUniform4iv,
 "___setErrNo": ___setErrNo,
 "_glStencilOpSeparate": _glStencilOpSeparate,
 "_JS_WebRequest_Abort": _JS_WebRequest_Abort,
 "___resumeException": ___resumeException,
 "_emscripten_glBlendFunc": _emscripten_glBlendFunc,
 "_mktime": _mktime,
 "_emscripten_glGetError": _emscripten_glGetError,
 "_emscripten_glBufferData": _emscripten_glBufferData,
 "_emscripten_glStencilMask": _emscripten_glStencilMask,
 "_glGenTextures": _glGenTextures,
 "_glGetIntegerv": _glGetIntegerv,
 "_glUniform3iv": _glUniform3iv,
 "_emscripten_glClearStencil": _emscripten_glClearStencil,
 "_JS_Sound_Stop": _JS_Sound_Stop,
 "emscriptenWebGLGet": emscriptenWebGLGet,
 "_emscripten_set_mouseup_callback": _emscripten_set_mouseup_callback,
 "_emscripten_glFinish": _emscripten_glFinish,
 "_emscripten_glClearDepth": _emscripten_glClearDepth,
 "_emscripten_glUniform1fv": _emscripten_glUniform1fv,
 "_glBindFramebuffer": _glBindFramebuffer,
 "_emscripten_glVertexAttrib1f": _emscripten_glVertexAttrib1f,
 "_glGenFramebuffers": _glGenFramebuffers,
 "_SDL_UpperBlitScaled": _SDL_UpperBlitScaled,
 "_emscripten_glUniform4i": _emscripten_glUniform4i,
 "_glUniform1fv": _glUniform1fv,
 "_llvm_pow_f64": _llvm_pow_f64,
 "__emscripten_sample_gamepad_data": __emscripten_sample_gamepad_data,
 "_glDeleteFramebuffers": _glDeleteFramebuffers,
 "_JS_FileSystem_Sync": _JS_FileSystem_Sync,
 "_IMG_Load": _IMG_Load,
 "___syscall183": ___syscall183,
 "_glCheckFramebufferStatus": _glCheckFramebufferStatus,
 "_JS_WebRequest_GetStatusLine": _JS_WebRequest_GetStatusLine,
 "_emscripten_glCreateShader": _emscripten_glCreateShader,
 "_glGetProgramBinary": _glGetProgramBinary,
 "___syscall192": ___syscall192,
 "_glProgramParameteri": _glProgramParameteri,
 "_localtime_r": _localtime_r,
 "_glBindTexture": _glBindTexture,
 "_strftime": _strftime,
 "_emscripten_glGetVertexAttribiv": _emscripten_glGetVertexAttribiv,
 "_glReadPixels": _glReadPixels,
 "_glGetActiveAttrib": _glGetActiveAttrib,
 "_emscripten_glUniformMatrix3fv": _emscripten_glUniformMatrix3fv,
 "_glUniform2iv": _glUniform2iv,
 "___syscall33": ___syscall33,
 "_pthread_key_create": _pthread_key_create,
 "_emscripten_glDeleteFramebuffers": _emscripten_glDeleteFramebuffers,
 "__inet_ntop4_raw": __inet_ntop4_raw,
 "___syscall39": ___syscall39,
 "___syscall38": ___syscall38,
 "_getpwuid": _getpwuid,
 "_glFrontFace": _glFrontFace,
 "_emscripten_glGetObjectParameterivARB": _emscripten_glGetObjectParameterivARB,
 "_glGetUniformiv": _glGetUniformiv,
 "_JS_SystemInfo_HasWebGL": _JS_SystemInfo_HasWebGL,
 "_emscripten_glGetUniformiv": _emscripten_glGetUniformiv,
 "_glGetActiveUniformBlockiv": _glGetActiveUniformBlockiv,
 "_glGetProgramiv": _glGetProgramiv,
 "___syscall168": ___syscall168,
 "_glScissor": _glScissor,
 "_emscripten_glClearColor": _emscripten_glClearColor,
 "_glGetFramebufferAttachmentParameteriv": _glGetFramebufferAttachmentParameteriv,
 "___cxa_find_matching_catch_4": ___cxa_find_matching_catch_4,
 "_emscripten_set_mousemove_callback": _emscripten_set_mousemove_callback,
 "_glBlitFramebuffer": _glBlitFramebuffer,
 "___cxa_find_matching_catch_2": ___cxa_find_matching_catch_2,
 "___cxa_find_matching_catch_3": ___cxa_find_matching_catch_3,
 "_emscripten_glDeleteTextures": _emscripten_glDeleteTextures,
 "_emscripten_exit_fullscreen": _emscripten_exit_fullscreen,
 "_JS_UNETWebSockets_HostsContainingMessagesPush": _JS_UNETWebSockets_HostsContainingMessagesPush,
 "_glGetShaderiv": _glGetShaderiv,
 "_llvm_eh_typeid_for": _llvm_eh_typeid_for,
 "_glBindBufferBase": _glBindBufferBase,
 "_glUniform4fv": _glUniform4fv,
 "_glTexSubImage3D": _glTexSubImage3D,
 "__exit": __exit,
 "_IMG_Load_RW": _IMG_Load_RW,
 "_glBindAttribLocation": _glBindAttribLocation,
 "_emscripten_glColorMask": _emscripten_glColorMask,
 "_emscripten_webgl_destroy_context": _emscripten_webgl_destroy_context,
 "_emscripten_glBindTexture": _emscripten_glBindTexture,
 "_glDeleteSamplers": _glDeleteSamplers,
 "_glUniform4iv": _glUniform4iv,
 "_emscripten_set_main_loop": _emscripten_set_main_loop,
 "_glUniformBlockBinding": _glUniformBlockBinding,
 "_emscripten_glIsShader": _emscripten_glIsShader,
 "_emscripten_glCompressedTexImage2D": _emscripten_glCompressedTexImage2D,
 "_glDisable": _glDisable,
 "_emscripten_glGetInfoLogARB": _emscripten_glGetInfoLogARB,
 "_emscripten_longjmp": _emscripten_longjmp,
 "_glTexSubImage2D": _glTexSubImage2D,
 "_atexit": _atexit,
 "_glFenceSync": _glFenceSync,
 "_glStencilFuncSeparate": _glStencilFuncSeparate,
 "_JS_Sound_ReleaseInstance": _JS_Sound_ReleaseInstance,
 "_emscripten_glGenRenderbuffers": _emscripten_glGenRenderbuffers,
 "_JS_SystemInfo_GetCurrentCanvasHeight": _JS_SystemInfo_GetCurrentCanvasHeight,
 "_JS_WebRequest_GetResponseHeaders": _JS_WebRequest_GetResponseHeaders,
 "_emscripten_glReleaseShaderCompiler": _emscripten_glReleaseShaderCompiler,
 "__ZN4FMOD13DSPConnection6setMixEf": __ZN4FMOD13DSPConnection6setMixEf,
 "_flock": _flock,
 "_SDL_RWFromFile": _SDL_RWFromFile,
 "_glUniform2fv": _glUniform2fv,
 "_emscripten_glFrontFace": _emscripten_glFrontFace,
 "_glDeleteProgram": _glDeleteProgram,
 "__ZSt18uncaught_exceptionv": __ZSt18uncaught_exceptionv,
 "_glBlendEquation": _glBlendEquation,
 "_emscripten_glUseProgram": _emscripten_glUseProgram,
 "__setLetterbox": __setLetterbox,
 "_glCreateProgram": _glCreateProgram,
 "_clock_gettime": _clock_gettime,
 "_emscripten_set_touchmove_callback": _emscripten_set_touchmove_callback,
 "_glGetAttribLocation": _glGetAttribLocation,
 "_Mix_PlayChannel": _Mix_PlayChannel,
 "_glCreateShader": _glCreateShader,
 "_emscripten_glReadPixels": _emscripten_glReadPixels,
 "_sysconf": _sysconf,
 "_utime": _utime,
 "_glEndQuery": _glEndQuery,
 "_JS_UNETWebSockets_SocketCreate": _JS_UNETWebSockets_SocketCreate,
 "_pthread_mutexattr_settype": _pthread_mutexattr_settype,
 "_glTexStorage2D": _glTexStorage2D,
 "_glGenBuffers": _glGenBuffers,
 "_glShaderSource": _glShaderSource,
 "_emscripten_glScissor": _emscripten_glScissor,
 "_glUniform3uiv": _glUniform3uiv,
 "_pthread_cleanup_push": _pthread_cleanup_push,
 "_llvm_trap": _llvm_trap,
 "_JS_Sound_SetVolume": _JS_Sound_SetVolume,
 "_JS_Cursor_SetShow": _JS_Cursor_SetShow,
 "_glPixelStorei": _glPixelStorei,
 "_emscripten_glIsBuffer": _emscripten_glIsBuffer,
 "_glValidateProgram": _glValidateProgram,
 "_glVertexAttribPointer": _glVertexAttribPointer,
 "_emscripten_glCompressedTexSubImage2D": _emscripten_glCompressedTexSubImage2D,
 "_glSamplerParameteri": _glSamplerParameteri,
 "_glBindSampler": _glBindSampler,
 "_JS_WebRequest_Release": _JS_WebRequest_Release,
 "_emscripten_get_main_loop_timing": _emscripten_get_main_loop_timing,
 "_JS_WebRequest_SetTimeout": _JS_WebRequest_SetTimeout,
 "_glGetVertexAttribiv": _glGetVertexAttribiv,
 "_JS_Log_Dump": _JS_Log_Dump,
 "_emscripten_glGetAttachedShaders": _emscripten_glGetAttachedShaders,
 "_emscripten_glGenTextures": _emscripten_glGenTextures,
 "_glBindRenderbuffer": _glBindRenderbuffer,
 "_pthread_cond_init": _pthread_cond_init,
 "_SDL_LockSurface": _SDL_LockSurface,
 "_gmtime": _gmtime,
 "_emscripten_glGetTexParameteriv": _emscripten_glGetTexParameteriv,
 "_glDeleteTextures": _glDeleteTextures,
 "_emscripten_set_mousedown_callback": _emscripten_set_mousedown_callback,
 "_emscripten_glClientActiveTexture": _emscripten_glClientActiveTexture,
 "_emscripten_glCheckFramebufferStatus": _emscripten_glCheckFramebufferStatus,
 "_emscripten_glUniform3f": _emscripten_glUniform3f,
 "_emscripten_glUniform3i": _emscripten_glUniform3i,
 "_glDrawBuffers": _glDrawBuffers,
 "_emscripten_glDeleteShader": _emscripten_glDeleteShader,
 "_glEnable": _glEnable,
 "_glUnmapBuffer": _glUnmapBuffer,
 "_glGetString": _glGetString,
 "_emscripten_glGetUniformLocation": _emscripten_glGetUniformLocation,
 "_emscripten_glEnableVertexAttribArray": _emscripten_glEnableVertexAttribArray,
 "_emscripten_get_now": _emscripten_get_now,
 "_emscripten_glGenFramebuffers": _emscripten_glGenFramebuffers,
 "emscriptenWebGLGetTexPixelData": emscriptenWebGLGetTexPixelData,
 "_gettimeofday": _gettimeofday,
 "___syscall202": ___syscall202,
 "_emscripten_glEnableClientState": _emscripten_glEnableClientState,
 "_JS_Sound_Init": _JS_Sound_Init,
 "_TTF_FontHeight": _TTF_FontHeight,
 "_emscripten_glDrawElements": _emscripten_glDrawElements,
 "_emscripten_get_num_gamepads": _emscripten_get_num_gamepads,
 "___buildEnvironment": ___buildEnvironment,
 "_JS_UNETWebSockets_HostsContainingMessagesCleanHost": _JS_UNETWebSockets_HostsContainingMessagesCleanHost,
 "_glClearDepthf": _glClearDepthf,
 "_tzset": _tzset,
 "_glIsEnabled": _glIsEnabled,
 "_JS_UNETWebSockets_Init": _JS_UNETWebSockets_Init,
 "_emscripten_glDisable": _emscripten_glDisable,
 "___cxa_end_catch": ___cxa_end_catch,
 "_emscripten_glDeleteRenderbuffers": _emscripten_glDeleteRenderbuffers,
 "_emscripten_glDrawElementsInstanced": _emscripten_glDrawElementsInstanced,
 "_emscripten_glVertexAttrib4f": _emscripten_glVertexAttrib4f,
 "_JS_Sound_Create_Channel": _JS_Sound_Create_Channel,
 "_emscripten_glPixelStorei": _emscripten_glPixelStorei,
 "_llvm_fabs_f32": _llvm_fabs_f32,
 "_glCopyBufferSubData": _glCopyBufferSubData,
 "_emscripten_webgl_init_context_attributes": _emscripten_webgl_init_context_attributes,
 "_emscripten_glFramebufferRenderbuffer": _emscripten_glFramebufferRenderbuffer,
 "_glBufferData": _glBufferData,
 "_emscripten_glRotatef": _emscripten_glRotatef,
 "_emscripten_glGetShaderiv": _emscripten_glGetShaderiv,
 "_JS_Eval_ClearTimeout": _JS_Eval_ClearTimeout,
 "___cxa_pure_virtual": ___cxa_pure_virtual,
 "_emscripten_glUniformMatrix4fv": _emscripten_glUniformMatrix4fv,
 "_emscripten_glGetPointerv": _emscripten_glGetPointerv,
 "_pthread_cond_wait": _pthread_cond_wait,
 "_clock": _clock,
 "_emscripten_glIsRenderbuffer": _emscripten_glIsRenderbuffer,
 "_emscripten_request_pointerlock": _emscripten_request_pointerlock,
 "___syscall40": ___syscall40,
 "_difftime": _difftime,
 "___syscall42": ___syscall42,
 "_emscripten_set_touchcancel_callback": _emscripten_set_touchcancel_callback,
 "__inet_pton6_raw": __inet_pton6_raw,
 "_glDeleteRenderbuffers": _glDeleteRenderbuffers,
 "_glGetShaderPrecisionFormat": _glGetShaderPrecisionFormat,
 "_JS_SystemInfo_GetMemory": _JS_SystemInfo_GetMemory,
 "_JS_Sound_SetLoop": _JS_Sound_SetLoop,
 "_JS_WebRequest_SetResponseHandler": _JS_WebRequest_SetResponseHandler,
 "_emscripten_set_focus_callback": _emscripten_set_focus_callback,
 "_pthread_mutexattr_destroy": _pthread_mutexattr_destroy,
 "_emscripten_glGetVertexAttribfv": _emscripten_glGetVertexAttribfv,
 "_SDL_PauseAudio": _SDL_PauseAudio,
 "_emscripten_glVertexAttrib3fv": _emscripten_glVertexAttrib3fv,
 "_glGetUniformLocation": _glGetUniformLocation,
 "_emscripten_glCompileShader": _emscripten_glCompileShader,
 "_glClear": _glClear,
 "_glBeginTransformFeedback": _glBeginTransformFeedback,
 "__arraySum": __arraySum,
 "_emscripten_glLinkProgram": _emscripten_glLinkProgram,
 "_JS_WebRequest_Create": _JS_WebRequest_Create,
 "_JS_UNETWebSockets_SocketSend": _JS_UNETWebSockets_SocketSend,
 "_emscripten_get_pointerlock_status": _emscripten_get_pointerlock_status,
 "_emscripten_glDrawRangeElements": _emscripten_glDrawRangeElements,
 "___unlock": ___unlock,
 "_pthread_create": _pthread_create,
 "_glGetActiveUniformsiv": _glGetActiveUniformsiv,
 "_pthread_setspecific": _pthread_setspecific,
 "_glColorMask": _glColorMask,
 "_emscripten_glGenBuffers": _emscripten_glGenBuffers,
 "_glCopyTexSubImage2D": _glCopyTexSubImage2D,
 "_emscripten_glCreateProgram": _emscripten_glCreateProgram,
 "_JS_WebRequest_SetProgressHandler": _JS_WebRequest_SetProgressHandler,
 "_glTexParameteri": _glTexParameteri,
 "_pthread_cond_destroy": _pthread_cond_destroy,
 "_emscripten_glDetachShader": _emscripten_glDetachShader,
 "_SDL_RWFromConstMem": _SDL_RWFromConstMem,
 "_glTexParameterf": _glTexParameterf,
 "_setenv": _setenv,
 "_emscripten_do_request_fullscreen": _emscripten_do_request_fullscreen,
 "_JS_UNETWebSockets_SocketRecvEvntBuffLengthFromHost": _JS_UNETWebSockets_SocketRecvEvntBuffLengthFromHost,
 "_glGenQueries": _glGenQueries,
 "_emscripten_glGetRenderbufferParameteriv": _emscripten_glGetRenderbufferParameteriv,
 "_emscripten_set_fullscreenchange_callback": _emscripten_set_fullscreenchange_callback,
 "_emscripten_glVertexAttribPointer": _emscripten_glVertexAttribPointer,
 "_glTexStorage3D": _glTexStorage3D,
 "_glIsVertexArray": _glIsVertexArray,
 "_JS_SystemInfo_GetBrowserName": _JS_SystemInfo_GetBrowserName,
 "_emscripten_glDrawArrays": _emscripten_glDrawArrays,
 "_emscripten_glPolygonOffset": _emscripten_glPolygonOffset,
 "_longjmp": _longjmp,
 "_emscripten_glBlendColor": _emscripten_glBlendColor,
 "_glGetShaderInfoLog": _glGetShaderInfoLog,
 "_emscripten_set_main_loop_timing": _emscripten_set_main_loop_timing,
 "___cxa_begin_catch": ___cxa_begin_catch,
 "_emscripten_glGetProgramiv": _emscripten_glGetProgramiv,
 "_glDeleteSync": _glDeleteSync,
 "__addDays": __addDays,
 "_JS_UNETWebSockets_SocketRecvEvntBuffFromHost": _JS_UNETWebSockets_SocketRecvEvntBuffFromHost,
 "_emscripten_glTexImage2D": _emscripten_glTexImage2D,
 "_glRenderbufferStorage": _glRenderbufferStorage,
 "__isLeapYear": __isLeapYear,
 "_JS_Sound_GetLength": _JS_Sound_GetLength,
 "_emscripten_glBlendEquationSeparate": _emscripten_glBlendEquationSeparate,
 "_emscripten_glGetString": _emscripten_glGetString,
 "_emscripten_glIsFramebuffer": _emscripten_glIsFramebuffer,
 "_glUniform2uiv": _glUniform2uiv,
 "_emscripten_glGetShaderSource": _emscripten_glGetShaderSource,
 "_unsetenv": _unsetenv,
 "_emscripten_glBindProgramARB": _emscripten_glBindProgramARB,
 "_JS_Sound_SetLoopPoints": _JS_Sound_SetLoopPoints,
 "_pthread_detach": _pthread_detach,
 "_emscripten_set_devicemotion_callback": _emscripten_set_devicemotion_callback,
 "___syscall85": ___syscall85,
 "_emscripten_glUniform2i": _emscripten_glUniform2i,
 "_emscripten_glUniform2f": _emscripten_glUniform2f,
 "_glGenTransformFeedbacks": _glGenTransformFeedbacks,
 "_JS_SystemInfo_GetWidth": _JS_SystemInfo_GetWidth,
 "_glGetProgramInfoLog": _glGetProgramInfoLog,
 "_emscripten_glTexParameterf": _emscripten_glTexParameterf,
 "_emscripten_glTexParameteri": _emscripten_glTexParameteri,
 "_JS_Sound_Load": _JS_Sound_Load,
 "_JS_Sound_Load_PCM": _JS_Sound_Load_PCM,
 "_emscripten_glGenVertexArrays": _emscripten_glGenVertexArrays,
 "_Mix_HaltMusic": _Mix_HaltMusic,
 "_glDeleteVertexArrays": _glDeleteVertexArrays,
 "_glGetStringi": _glGetStringi,
 "_emscripten_glBindAttribLocation": _emscripten_glBindAttribLocation,
 "_llvm_pow_f32": _llvm_pow_f32,
 "_glDepthFunc": _glDepthFunc,
 "___cxa_allocate_exception": ___cxa_allocate_exception,
 "_emscripten_set_canvas_size": _emscripten_set_canvas_size,
 "_emscripten_asm_const_v": _emscripten_asm_const_v,
 "_emscripten_glClearDepthf": _emscripten_glClearDepthf,
 "_JS_SystemInfo_GetDocumentURL": _JS_SystemInfo_GetDocumentURL,
 "_emscripten_glMatrixMode": _emscripten_glMatrixMode,
 "_glBlendFuncSeparate": _glBlendFuncSeparate,
 "___syscall10": ___syscall10,
 "_emscripten_glNormalPointer": _emscripten_glNormalPointer,
 "_emscripten_glHint": _emscripten_glHint,
 "_emscripten_glEnable": _emscripten_glEnable,
 "___syscall3": ___syscall3,
 "___lock": ___lock,
 "_emscripten_glBindFramebuffer": _emscripten_glBindFramebuffer,
 "___syscall6": ___syscall6,
 "___syscall5": ___syscall5,
 "___syscall4": ___syscall4,
 "_emscripten_glBindRenderbuffer": _emscripten_glBindRenderbuffer,
 "_time": _time,
 "_emscripten_glGetFramebufferAttachmentParameteriv": _emscripten_glGetFramebufferAttachmentParameteriv,
 "_emscripten_set_wheel_callback": _emscripten_set_wheel_callback,
 "_exit": _exit,
 "_emscripten_glGetActiveAttrib": _emscripten_glGetActiveAttrib,
 "__inet_pton4_raw": __inet_pton4_raw,
 "_putenv": _putenv,
 "___syscall268": ___syscall268,
 "___syscall102": ___syscall102,
 "_JS_UNETWebSockets_AddHost": _JS_UNETWebSockets_AddHost,
 "_emscripten_set_keypress_callback": _emscripten_set_keypress_callback,
 "_JS_SystemInfo_GetOS": _JS_SystemInfo_GetOS,
 "_glMapBufferRange": _glMapBufferRange,
 "_JS_SystemInfo_GetBrowserVersionString": _JS_SystemInfo_GetBrowserVersionString,
 "_glGetIntegeri_v": _glGetIntegeri_v,
 "_glFramebufferTexture2D": _glFramebufferTexture2D,
 "_JS_Cursor_SetImage": _JS_Cursor_SetImage,
 "_emscripten_glShaderBinary": _emscripten_glShaderBinary,
 "_emscripten_glGetShaderInfoLog": _emscripten_glGetShaderInfoLog,
 "_glUniform3fv": _glUniform3fv,
 "_emscripten_glGetVertexAttribPointerv": _emscripten_glGetVertexAttribPointerv,
 "_glClientWaitSync": _glClientWaitSync,
 "_JS_FileSystem_SetSyncInterval": _JS_FileSystem_SetSyncInterval,
 "_emscripten_set_deviceorientation_callback": _emscripten_set_deviceorientation_callback,
 "___syscall193": ___syscall193,
 "_emscripten_glGetActiveUniform": _emscripten_glGetActiveUniform,
 "emscriptenWebGLGetVertexAttrib": emscriptenWebGLGetVertexAttrib,
 "___syscall197": ___syscall197,
 "___syscall196": ___syscall196,
 "___syscall195": ___syscall195,
 "___syscall194": ___syscall194,
 "___syscall199": ___syscall199,
 "_emscripten_glDeleteProgram": _emscripten_glDeleteProgram,
 "_glUniform1i": _glUniform1i,
 "_glFlushMappedBufferRange": _glFlushMappedBufferRange,
 "_emscripten_glTexSubImage2D": _emscripten_glTexSubImage2D,
 "_pthread_mutex_destroy": _pthread_mutex_destroy,
 "_emscripten_glColorPointer": _emscripten_glColorPointer,
 "_glTransformFeedbackVaryings": _glTransformFeedbackVaryings,
 "_glGetShaderSource": _glGetShaderSource,
 "_emscripten_glViewport": _emscripten_glViewport,
 "_emscripten_glDepthMask": _emscripten_glDepthMask,
 "_emscripten_glDrawBuffers": _emscripten_glDrawBuffers,
 "_emscripten_glLineWidth": _emscripten_glLineWidth,
 "_glCompileShader": _glCompileShader,
 "_emscripten_exit_pointerlock": _emscripten_exit_pointerlock,
 "_JS_WebRequest_SetRequestHeader": _JS_WebRequest_SetRequestHeader,
 "_abort": _abort,
 "_JS_UNETWebSockets_SocketCleanEvntFromHost": _JS_UNETWebSockets_SocketCleanEvntFromHost,
 "_JS_Sound_GetLoadState": _JS_Sound_GetLoadState,
 "_glTexImage2D": _glTexImage2D,
 "_glUniform4uiv": _glUniform4uiv,
 "_glFlush": _glFlush,
 "_emscripten_glLoadIdentity": _emscripten_glLoadIdentity,
 "_glDeleteShader": _glDeleteShader,
 "_emscripten_glShaderSource": _emscripten_glShaderSource,
 "_glGenVertexArrays": _glGenVertexArrays,
 "_SDL_CloseAudio": _SDL_CloseAudio,
 "___gxx_personality_v0": ___gxx_personality_v0,
 "_emscripten_get_fullscreen_status": _emscripten_get_fullscreen_status,
 "_emscripten_set_touchend_callback": _emscripten_set_touchend_callback,
 "_pthread_cond_signal": _pthread_cond_signal,
 "_glGenRenderbuffers": _glGenRenderbuffers,
 "_emscripten_glSampleCoverage": _emscripten_glSampleCoverage,
 "_emscripten_glFrustum": _emscripten_glFrustum,
 "_Mix_FreeChunk": _Mix_FreeChunk,
 "_emscripten_glDepthRangef": _emscripten_glDepthRangef,
 "_JS_Sound_SetPitch": _JS_Sound_SetPitch,
 "_emscripten_glGenerateMipmap": _emscripten_glGenerateMipmap,
 "_glCopyTexImage2D": _glCopyTexImage2D,
 "_emscripten_glIsTexture": _emscripten_glIsTexture,
 "_glCompressedTexSubImage3D": _glCompressedTexSubImage3D,
 "_emscripten_glBindVertexArray": _emscripten_glBindVertexArray,
 "_SDL_UpperBlit": _SDL_UpperBlit,
 "___syscall51": ___syscall51,
 "_emscripten_glActiveTexture": _emscripten_glActiveTexture,
 "_emscripten_set_keyup_callback": _emscripten_set_keyup_callback,
 "_emscripten_glDeleteVertexArrays": _emscripten_glDeleteVertexArrays,
 "___syscall54": ___syscall54,
 "_glDeleteTransformFeedbacks": _glDeleteTransformFeedbacks,
 "_emscripten_glUniform2iv": _emscripten_glUniform2iv,
 "_pthread_mutexattr_init": _pthread_mutexattr_init,
 "_glBufferSubData": _glBufferSubData,
 "_getenv": _getenv,
 "_SDL_GL_SwapBuffers": _SDL_GL_SwapBuffers,
 "_emscripten_glCopyTexSubImage2D": _emscripten_glCopyTexSubImage2D,
 "_glGetInternalformativ": _glGetInternalformativ,
 "_glGetActiveUniform": _glGetActiveUniform,
 "_glStencilMask": _glStencilMask,
 "_JS_UNETWebSockets_SocketClose": _JS_UNETWebSockets_SocketClose,
 "DYNAMICTOP_PTR": DYNAMICTOP_PTR,
 "tempDoublePtr": tempDoublePtr,
 "ABORT": ABORT,
 "STACKTOP": STACKTOP,
 "STACK_MAX": STACK_MAX,
 "cttz_i8": cttz_i8
};
// EMSCRIPTEN_START_ASM

var asm =Module["asm"]// EMSCRIPTEN_END_ASM
(Module.asmGlobalArg, Module.asmLibraryArg, buffer);
var real___GLOBAL__sub_I_runtime_camera_culling_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera_culling_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera_culling_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera_culling_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_File_cpp = asm["__GLOBAL__sub_I_File_cpp"];
asm["__GLOBAL__sub_I_File_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_File_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_video_lump_cpp = asm["__GLOBAL__sub_I_runtime_video_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_video_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_video_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp = asm["__GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_terrain_lump_cpp_4746 = asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp_4746"];
asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp_4746"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_terrain_lump_cpp_4746.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp = asm["__GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp.apply(null, arguments);
});
var real__bitshift64Lshr = asm["_bitshift64Lshr"];
asm["_bitshift64Lshr"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__bitshift64Lshr.apply(null, arguments);
});
var real___GLOBAL__sub_I_GenericMetadata_cpp = asm["__GLOBAL__sub_I_GenericMetadata_cpp"];
asm["__GLOBAL__sub_I_GenericMetadata_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GenericMetadata_cpp.apply(null, arguments);
});
var real____cxa_demangle = asm["___cxa_demangle"];
asm["___cxa_demangle"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____cxa_demangle.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera2_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_baseclasses_lump_cpp = asm["__GLOBAL__sub_I_runtime_baseclasses_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_baseclasses_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_baseclasses_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Console_cpp = asm["__GLOBAL__sub_I_Console_cpp"];
asm["__GLOBAL__sub_I_Console_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Console_cpp.apply(null, arguments);
});
var real__bitshift64Ashr = asm["_bitshift64Ashr"];
asm["_bitshift64Ashr"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__bitshift64Ashr.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_GfxDeviceNull_cpp = asm["__GLOBAL__sub_I_GfxDeviceNull_cpp"];
asm["__GLOBAL__sub_I_GfxDeviceNull_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GfxDeviceNull_cpp.apply(null, arguments);
});
var real__sbrk = asm["_sbrk"];
asm["_sbrk"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__sbrk.apply(null, arguments);
});
var real___GLOBAL__sub_I_GCHandle_cpp = asm["__GLOBAL__sub_I_GCHandle_cpp"];
asm["__GLOBAL__sub_I_GCHandle_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GCHandle_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Assembly_cpp = asm["__GLOBAL__sub_I_Assembly_cpp"];
asm["__GLOBAL__sub_I_Assembly_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Assembly_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_allocator2_lump_cpp = asm["__GLOBAL__sub_I_runtime_allocator2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_allocator2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_allocator2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp = asm["__GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_profiler_lump_cpp = asm["__GLOBAL__sub_I_runtime_profiler_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_profiler_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_profiler_lump_cpp.apply(null, arguments);
});
var real____udivmoddi4 = asm["___udivmoddi4"];
asm["___udivmoddi4"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____udivmoddi4.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics5_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics5_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics5_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics5_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_ProfilerImpl_cpp = asm["__GLOBAL__sub_I_ProfilerImpl_cpp"];
asm["__GLOBAL__sub_I_ProfilerImpl_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_ProfilerImpl_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_audio2_lump_cpp = asm["__GLOBAL__sub_I_runtime_audio2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_audio2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_audio2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_animation3_lump_cpp = asm["__GLOBAL__sub_I_runtime_animation3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_animation3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_animation3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp = asm["__GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp"];
asm["__GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_utilities3_lump_cpp = asm["__GLOBAL__sub_I_runtime_utilities3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_utilities3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_utilities3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_preloadmanager_lump_cpp = asm["__GLOBAL__sub_I_runtime_preloadmanager_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_preloadmanager_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_preloadmanager_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_SpriteRendererJobs_cpp = asm["__GLOBAL__sub_I_SpriteRendererJobs_cpp"];
asm["__GLOBAL__sub_I_SpriteRendererJobs_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SpriteRendererJobs_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_TextMeshGenerator_cpp = asm["__GLOBAL__sub_I_TextMeshGenerator_cpp"];
asm["__GLOBAL__sub_I_TextMeshGenerator_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_TextMeshGenerator_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_GenericMethod_cpp = asm["__GLOBAL__sub_I_GenericMethod_cpp"];
asm["__GLOBAL__sub_I_GenericMethod_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GenericMethod_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp = asm["__GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp.apply(null, arguments);
});
var real____cxa_can_catch = asm["___cxa_can_catch"];
asm["___cxa_can_catch"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____cxa_can_catch.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics2_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics2_lump_cpp.apply(null, arguments);
});
var real__free = asm["_free"];
asm["_free"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__free.apply(null, arguments);
});
var real___GLOBAL__sub_I_SaveAndLoadHelper_cpp = asm["__GLOBAL__sub_I_SaveAndLoadHelper_cpp"];
asm["__GLOBAL__sub_I_SaveAndLoadHelper_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SaveAndLoadHelper_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_AppDomain_cpp = asm["__GLOBAL__sub_I_AppDomain_cpp"];
asm["__GLOBAL__sub_I_AppDomain_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_AppDomain_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp.apply(null, arguments);
});
var real__strstr = asm["_strstr"];
asm["_strstr"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__strstr.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ui_lump_cpp = asm["__GLOBAL__sub_I_runtime_ui_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ui_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ui_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_MetadataCache_cpp = asm["__GLOBAL__sub_I_MetadataCache_cpp"];
asm["__GLOBAL__sub_I_MetadataCache_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_MetadataCache_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_CmEventProfiler_cpp = asm["__GLOBAL__sub_I_CmEventProfiler_cpp"];
asm["__GLOBAL__sub_I_CmEventProfiler_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_CmEventProfiler_cpp.apply(null, arguments);
});
var real__memalign = asm["_memalign"];
asm["_memalign"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__memalign.apply(null, arguments);
});
var real___GLOBAL__sub_I_Environment_cpp = asm["__GLOBAL__sub_I_Environment_cpp"];
asm["__GLOBAL__sub_I_Environment_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Environment_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Socket_cpp = asm["__GLOBAL__sub_I_Socket_cpp"];
asm["__GLOBAL__sub_I_Socket_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Socket_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp = asm["__GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp.apply(null, arguments);
});
var real__SetFullscreen = asm["_SetFullscreen"];
asm["_SetFullscreen"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__SetFullscreen.apply(null, arguments);
});
var real__main = asm["_main"];
asm["_main"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__main.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_misc3_lump_cpp = asm["__GLOBAL__sub_I_runtime_misc3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_misc3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_misc3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_core_callbacks_lump_cpp = asm["__GLOBAL__sub_I_runtime_core_callbacks_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_core_callbacks_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_core_callbacks_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera3_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp = asm["__GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_GUIText_cpp = asm["__GLOBAL__sub_I_GUIText_cpp"];
asm["__GLOBAL__sub_I_GUIText_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GUIText_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics6_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics6_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics6_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics6_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_umbra_cpp = asm["__GLOBAL__sub_I_umbra_cpp"];
asm["__GLOBAL__sub_I_umbra_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_umbra_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_PluginInterfaceVR_cpp = asm["__GLOBAL__sub_I_PluginInterfaceVR_cpp"];
asm["__GLOBAL__sub_I_PluginInterfaceVR_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_PluginInterfaceVR_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_vehicles_lump_cpp = asm["__GLOBAL__sub_I_runtime_vehicles_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_vehicles_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_vehicles_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_VRGfxHelpers_cpp = asm["__GLOBAL__sub_I_VRGfxHelpers_cpp"];
asm["__GLOBAL__sub_I_VRGfxHelpers_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_VRGfxHelpers_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_network_lump_cpp = asm["__GLOBAL__sub_I_runtime_network_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_network_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_network_lump_cpp.apply(null, arguments);
});
var real____cxa_is_pointer_type = asm["___cxa_is_pointer_type"];
asm["___cxa_is_pointer_type"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____cxa_is_pointer_type.apply(null, arguments);
});
var real__llvm_ctlz_i64 = asm["_llvm_ctlz_i64"];
asm["_llvm_ctlz_i64"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__llvm_ctlz_i64.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_physics2d_lump_cpp = asm["__GLOBAL__sub_I_runtime_physics2d_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_physics2d_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_physics2d_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_lod_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_lod_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_lod_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_lod_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp = asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp"];
asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp.apply(null, arguments);
});
var real__llvm_cttz_i32 = asm["_llvm_cttz_i32"];
asm["_llvm_cttz_i32"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__llvm_cttz_i32.apply(null, arguments);
});
var real___GLOBAL__sub_I_TransformFeedbackSkinning_cpp = asm["__GLOBAL__sub_I_TransformFeedbackSkinning_cpp"];
asm["__GLOBAL__sub_I_TransformFeedbackSkinning_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_TransformFeedbackSkinning_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_DirectorManager_cpp = asm["__GLOBAL__sub_I_DirectorManager_cpp"];
asm["__GLOBAL__sub_I_DirectorManager_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_DirectorManager_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_RCW_cpp = asm["__GLOBAL__sub_I_RCW_cpp"];
asm["__GLOBAL__sub_I_RCW_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_RCW_cpp.apply(null, arguments);
});
var real____divdi3 = asm["___divdi3"];
asm["___divdi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____divdi3.apply(null, arguments);
});
var real___GLOBAL__sub_I_Interlocked_cpp = asm["__GLOBAL__sub_I_Interlocked_cpp"];
asm["__GLOBAL__sub_I_Interlocked_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Interlocked_cpp.apply(null, arguments);
});
var real__ntohs = asm["_ntohs"];
asm["_ntohs"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__ntohs.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ai_internal_lump_cpp = asm["__GLOBAL__sub_I_runtime_ai_internal_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ai_internal_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ai_internal_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_gfxdevice_lump_cpp = asm["__GLOBAL__sub_I_runtime_gfxdevice_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_gfxdevice_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_gfxdevice_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Player_cpp = asm["__GLOBAL__sub_I_Player_cpp"];
asm["__GLOBAL__sub_I_Player_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Player_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp = asm["__GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_MemoryManager_cpp = asm["__GLOBAL__sub_I_MemoryManager_cpp"];
asm["__GLOBAL__sub_I_MemoryManager_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_MemoryManager_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_MemoryMappedFile_cpp = asm["__GLOBAL__sub_I_MemoryMappedFile_cpp"];
asm["__GLOBAL__sub_I_MemoryMappedFile_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_MemoryMappedFile_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp = asm["__GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp.apply(null, arguments);
});
var real__llvm_bswap_i32 = asm["_llvm_bswap_i32"];
asm["_llvm_bswap_i32"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__llvm_bswap_i32.apply(null, arguments);
});
var real___GLOBAL__sub_I_String_cpp = asm["__GLOBAL__sub_I_String_cpp"];
asm["__GLOBAL__sub_I_String_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_String_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_math_random_lump_cpp = asm["__GLOBAL__sub_I_runtime_math_random_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_math_random_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_math_random_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Reflection_cpp = asm["__GLOBAL__sub_I_Reflection_cpp"];
asm["__GLOBAL__sub_I_Reflection_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Reflection_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_SwSolverKernel_cpp = asm["__GLOBAL__sub_I_SwSolverKernel_cpp"];
asm["__GLOBAL__sub_I_SwSolverKernel_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SwSolverKernel_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_imgui_lump_cpp = asm["__GLOBAL__sub_I_runtime_imgui_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_imgui_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_imgui_lump_cpp.apply(null, arguments);
});
var real__pthread_mutex_lock = asm["_pthread_mutex_lock"];
asm["_pthread_mutex_lock"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__pthread_mutex_lock.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_serialize_lump_cpp = asm["__GLOBAL__sub_I_runtime_serialize_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_serialize_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_serialize_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_jobs_lump_cpp = asm["__GLOBAL__sub_I_runtime_jobs_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_jobs_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_jobs_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_ArrayMetadata_cpp = asm["__GLOBAL__sub_I_ArrayMetadata_cpp"];
asm["__GLOBAL__sub_I_ArrayMetadata_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_ArrayMetadata_cpp.apply(null, arguments);
});
var real__roundf = asm["_roundf"];
asm["_roundf"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__roundf.apply(null, arguments);
});
var real___GLOBAL__sub_I_SizeByVelocityModule_cpp = asm["__GLOBAL__sub_I_SizeByVelocityModule_cpp"];
asm["__GLOBAL__sub_I_SizeByVelocityModule_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SizeByVelocityModule_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_mono_lump_cpp = asm["__GLOBAL__sub_I_runtime_mono_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_mono_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_mono_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_misc_lump_cpp = asm["__GLOBAL__sub_I_runtime_misc_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_misc_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_misc_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp = asm["__GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_physics2d2_lump_cpp = asm["__GLOBAL__sub_I_runtime_physics2d2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_physics2d2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_physics2d2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_LibraryLoader_cpp = asm["__GLOBAL__sub_I_LibraryLoader_cpp"];
asm["__GLOBAL__sub_I_LibraryLoader_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_LibraryLoader_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_terrain_lump_cpp = asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_terrain_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_assetbundles_lump_cpp = asm["__GLOBAL__sub_I_runtime_assetbundles_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_assetbundles_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_assetbundles_lump_cpp.apply(null, arguments);
});
var real__SendMessageFloat = asm["_SendMessageFloat"];
asm["_SendMessageFloat"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__SendMessageFloat.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_interfaces_lump_cpp = asm["__GLOBAL__sub_I_runtime_interfaces_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_interfaces_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_interfaces_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp = asm["__GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_scripting_lump_cpp = asm["__GLOBAL__sub_I_runtime_scripting_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_scripting_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_scripting_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_2d_sorting_lump_cpp = asm["__GLOBAL__sub_I_runtime_2d_sorting_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_2d_sorting_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_2d_sorting_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Assembly_cpp_63068 = asm["__GLOBAL__sub_I_Assembly_cpp_63068"];
asm["__GLOBAL__sub_I_Assembly_cpp_63068"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Assembly_cpp_63068.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_dynamics_lump_cpp = asm["__GLOBAL__sub_I_runtime_dynamics_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_dynamics_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_dynamics_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_UnityAdsSettings_cpp = asm["__GLOBAL__sub_I_UnityAdsSettings_cpp"];
asm["__GLOBAL__sub_I_UnityAdsSettings_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_UnityAdsSettings_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_utilities_lump_cpp = asm["__GLOBAL__sub_I_runtime_utilities_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_utilities_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_utilities_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_StackTrace_cpp = asm["__GLOBAL__sub_I_StackTrace_cpp"];
asm["__GLOBAL__sub_I_StackTrace_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_StackTrace_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_geometry_lump_cpp = asm["__GLOBAL__sub_I_runtime_geometry_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_geometry_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_geometry_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_allocator_lump_cpp = asm["__GLOBAL__sub_I_runtime_allocator_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_allocator_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_allocator_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_profiler_internal_lump_cpp = asm["__GLOBAL__sub_I_runtime_profiler_internal_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_profiler_internal_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_profiler_internal_lump_cpp.apply(null, arguments);
});
var real__i64Subtract = asm["_i64Subtract"];
asm["_i64Subtract"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__i64Subtract.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_gamecode_lump_cpp = asm["__GLOBAL__sub_I_runtime_gamecode_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_gamecode_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_gamecode_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics4_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics4_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics4_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics4_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_SwCollision_cpp = asm["__GLOBAL__sub_I_SwCollision_cpp"];
asm["__GLOBAL__sub_I_SwCollision_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SwCollision_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_animation_lump_cpp = asm["__GLOBAL__sub_I_runtime_animation_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_animation_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_animation_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_shaders_lump_cpp = asm["__GLOBAL__sub_I_runtime_shaders_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_shaders_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_shaders_lump_cpp.apply(null, arguments);
});
var real__llvm_bswap_i16 = asm["_llvm_bswap_i16"];
asm["_llvm_bswap_i16"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__llvm_bswap_i16.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp = asm["__GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp = asm["__GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp"];
asm["__GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp.apply(null, arguments);
});
var real____remdi3 = asm["___remdi3"];
asm["___remdi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____remdi3.apply(null, arguments);
});
var real___GLOBAL__sub_I_ThreadImpl_cpp = asm["__GLOBAL__sub_I_ThreadImpl_cpp"];
asm["__GLOBAL__sub_I_ThreadImpl_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_ThreadImpl_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Class_cpp = asm["__GLOBAL__sub_I_Class_cpp"];
asm["__GLOBAL__sub_I_Class_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Class_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_geometry2_lump_cpp = asm["__GLOBAL__sub_I_runtime_geometry2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_geometry2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_geometry2_lump_cpp.apply(null, arguments);
});
var real__pthread_cond_broadcast = asm["_pthread_cond_broadcast"];
asm["_pthread_cond_broadcast"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__pthread_cond_broadcast.apply(null, arguments);
});
var real___GLOBAL__sub_I_Image_cpp = asm["__GLOBAL__sub_I_Image_cpp"];
asm["__GLOBAL__sub_I_Image_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Image_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_modules_lump_cpp = asm["__GLOBAL__sub_I_runtime_modules_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_modules_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_modules_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera_lump_cpp.apply(null, arguments);
});
var real____muldsi3 = asm["___muldsi3"];
asm["___muldsi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____muldsi3.apply(null, arguments);
});
var real__testSetjmp = asm["_testSetjmp"];
asm["_testSetjmp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__testSetjmp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp = asm["__GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_SwSelfCollision_cpp = asm["__GLOBAL__sub_I_SwSelfCollision_cpp"];
asm["__GLOBAL__sub_I_SwSelfCollision_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SwSelfCollision_cpp.apply(null, arguments);
});
var real____cxx_global_var_init13 = asm["___cxx_global_var_init13"];
asm["___cxx_global_var_init13"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____cxx_global_var_init13.apply(null, arguments);
});
var real___GLOBAL__sub_I_Il2CppCodeRegistration_cpp = asm["__GLOBAL__sub_I_Il2CppCodeRegistration_cpp"];
asm["__GLOBAL__sub_I_Il2CppCodeRegistration_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Il2CppCodeRegistration_cpp.apply(null, arguments);
});
var real__malloc = asm["_malloc"];
asm["_malloc"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__malloc.apply(null, arguments);
});
var real___GLOBAL__sub_I_Runtime_cpp = asm["__GLOBAL__sub_I_Runtime_cpp"];
asm["__GLOBAL__sub_I_Runtime_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Runtime_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_misc2_lump_cpp = asm["__GLOBAL__sub_I_runtime_misc2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_misc2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_misc2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_animation2_lump_cpp = asm["__GLOBAL__sub_I_runtime_animation2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_animation2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_animation2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_dynamics2_lump_cpp = asm["__GLOBAL__sub_I_runtime_dynamics2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_dynamics2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_dynamics2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_half_cpp = asm["__GLOBAL__sub_I_half_cpp"];
asm["__GLOBAL__sub_I_half_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_half_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp = asm["__GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp.apply(null, arguments);
});
var real__SendMessage = asm["_SendMessage"];
asm["_SendMessage"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__SendMessage.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_animation_director_lump_cpp = asm["__GLOBAL__sub_I_runtime_animation_director_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_animation_director_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_animation_director_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_particlesystem_lump_cpp = asm["__GLOBAL__sub_I_runtime_particlesystem_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_particlesystem_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_particlesystem_lump_cpp.apply(null, arguments);
});
var real____udivdi3 = asm["___udivdi3"];
asm["___udivdi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____udivdi3.apply(null, arguments);
});
var real___GLOBAL__sub_I_VRDevice_cpp = asm["__GLOBAL__sub_I_VRDevice_cpp"];
asm["__GLOBAL__sub_I_VRDevice_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_VRDevice_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Thread_cpp_62510 = asm["__GLOBAL__sub_I_Thread_cpp_62510"];
asm["__GLOBAL__sub_I_Thread_cpp_62510"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Thread_cpp_62510.apply(null, arguments);
});
var real___GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp = asm["__GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp"];
asm["__GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_transform_lump_cpp = asm["__GLOBAL__sub_I_runtime_transform_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_transform_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_transform_lump_cpp.apply(null, arguments);
});
var real__InjectProfilerSample = asm["_InjectProfilerSample"];
asm["_InjectProfilerSample"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__InjectProfilerSample.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_terrain2_lump_cpp = asm["__GLOBAL__sub_I_runtime_terrain2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_terrain2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_terrain2_lump_cpp.apply(null, arguments);
});
var real__bitshift64Shl = asm["_bitshift64Shl"];
asm["_bitshift64Shl"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__bitshift64Shl.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp = asm["__GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_input_lump_cpp = asm["__GLOBAL__sub_I_runtime_input_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_input_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_input_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_audio_lump_cpp = asm["__GLOBAL__sub_I_runtime_audio_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_audio_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_audio_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Thread_cpp = asm["__GLOBAL__sub_I_Thread_cpp"];
asm["__GLOBAL__sub_I_Thread_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Thread_cpp.apply(null, arguments);
});
var real____cxx_global_var_init_2 = asm["___cxx_global_var_init_2"];
asm["___cxx_global_var_init_2"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____cxx_global_var_init_2.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_baseclasses2_lump_cpp = asm["__GLOBAL__sub_I_runtime_baseclasses2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_baseclasses2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_baseclasses2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp = asm["__GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_terrainphysics_lump_cpp = asm["__GLOBAL__sub_I_runtime_terrainphysics_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_terrainphysics_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_terrainphysics_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_GarbageCollector_cpp = asm["__GLOBAL__sub_I_GarbageCollector_cpp"];
asm["__GLOBAL__sub_I_GarbageCollector_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GarbageCollector_cpp.apply(null, arguments);
});
var real____muldi3 = asm["___muldi3"];
asm["___muldi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____muldi3.apply(null, arguments);
});
var real___GLOBAL__sub_I_SwInterCollision_cpp = asm["__GLOBAL__sub_I_SwInterCollision_cpp"];
asm["__GLOBAL__sub_I_SwInterCollision_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_SwInterCollision_cpp.apply(null, arguments);
});
var real____uremdi3 = asm["___uremdi3"];
asm["___uremdi3"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____uremdi3.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_scenemanager_lump_cpp = asm["__GLOBAL__sub_I_runtime_scenemanager_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_scenemanager_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_scenemanager_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_GlslGpuProgramGLES_cpp = asm["__GLOBAL__sub_I_GlslGpuProgramGLES_cpp"];
asm["__GLOBAL__sub_I_GlslGpuProgramGLES_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_GlslGpuProgramGLES_cpp.apply(null, arguments);
});
var real__htonl = asm["_htonl"];
asm["_htonl"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__htonl.apply(null, arguments);
});
var real__realloc = asm["_realloc"];
asm["_realloc"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__realloc.apply(null, arguments);
});
var real__i64Add = asm["_i64Add"];
asm["_i64Add"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__i64Add.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_logging_lump_cpp = asm["__GLOBAL__sub_I_runtime_logging_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_logging_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_logging_lump_cpp.apply(null, arguments);
});
var real__pthread_self = asm["_pthread_self"];
asm["_pthread_self"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__pthread_self.apply(null, arguments);
});
var real__pthread_mutex_unlock = asm["_pthread_mutex_unlock"];
asm["_pthread_mutex_unlock"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__pthread_mutex_unlock.apply(null, arguments);
});
var real___GLOBAL__sub_I_PxsFluidDynamics_cpp = asm["__GLOBAL__sub_I_PxsFluidDynamics_cpp"];
asm["__GLOBAL__sub_I_PxsFluidDynamics_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_PxsFluidDynamics_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_utilities2_lump_cpp = asm["__GLOBAL__sub_I_runtime_utilities2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_utilities2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_utilities2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_video_lump_cpp_5815 = asm["__GLOBAL__sub_I_runtime_video_lump_cpp_5815"];
asm["__GLOBAL__sub_I_runtime_video_lump_cpp_5815"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_video_lump_cpp_5815.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_cloth_lump_cpp = asm["__GLOBAL__sub_I_runtime_cloth_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_cloth_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_cloth_lump_cpp.apply(null, arguments);
});
var real__htons = asm["_htons"];
asm["_htons"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__htons.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_application_lump_cpp = asm["__GLOBAL__sub_I_runtime_application_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_application_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_application_lump_cpp.apply(null, arguments);
});
var real____errno_location = asm["___errno_location"];
asm["___errno_location"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real____errno_location.apply(null, arguments);
});
var real__SendMessageString = asm["_SendMessageString"];
asm["_SendMessageString"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__SendMessageString.apply(null, arguments);
});
var real__saveSetjmp = asm["_saveSetjmp"];
asm["_saveSetjmp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__saveSetjmp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp = asm["__GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp = asm["__GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp"];
asm["__GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp.apply(null, arguments);
});
var real__memmove = asm["_memmove"];
asm["_memmove"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real__memmove.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_unityconnect_lump_cpp = asm["__GLOBAL__sub_I_runtime_unityconnect_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_unityconnect_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_unityconnect_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp = asm["__GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp"];
asm["__GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp = asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp"];
asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_FontImpl_cpp = asm["__GLOBAL__sub_I_FontImpl_cpp"];
asm["__GLOBAL__sub_I_FontImpl_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_FontImpl_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_camera4_lump_cpp = asm["__GLOBAL__sub_I_runtime_camera4_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_camera4_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_camera4_lump_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_Error_cpp = asm["__GLOBAL__sub_I_Error_cpp"];
asm["__GLOBAL__sub_I_Error_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_Error_cpp.apply(null, arguments);
});
var real___GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp = asm["__GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp"];
asm["__GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp"] = (function() {
 assert(runtimeInitialized, "you need to wait for the runtime to be ready (e.g. wait for main() to be called)");
 assert(!runtimeExited, "the runtime was exited (use NO_EXIT_RUNTIME to keep it alive after main() exits)");
 return real___GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp.apply(null, arguments);
});
var __GLOBAL__sub_I_runtime_camera_culling_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera_culling_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera_culling_lump_cpp"];
var __GLOBAL__sub_I_File_cpp = Module["__GLOBAL__sub_I_File_cpp"] = asm["__GLOBAL__sub_I_File_cpp"];
var __GLOBAL__sub_I_runtime_video_lump_cpp = Module["__GLOBAL__sub_I_runtime_video_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_video_lump_cpp"];
var __GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp = Module["__GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_2d_spritetiling_lump_cpp"];
var __GLOBAL__sub_I_runtime_terrain_lump_cpp_4746 = Module["__GLOBAL__sub_I_runtime_terrain_lump_cpp_4746"] = asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp_4746"];
var __GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp = Module["__GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ai_internal_navmesh_lump_cpp"];
var __GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera_renderlayers_lump_cpp"];
var _bitshift64Lshr = Module["_bitshift64Lshr"] = asm["_bitshift64Lshr"];
var __GLOBAL__sub_I_GenericMetadata_cpp = Module["__GLOBAL__sub_I_GenericMetadata_cpp"] = asm["__GLOBAL__sub_I_GenericMetadata_cpp"];
var ___cxa_demangle = Module["___cxa_demangle"] = asm["___cxa_demangle"];
var __GLOBAL__sub_I_runtime_camera2_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera2_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_mesh_lump_cpp"];
var __GLOBAL__sub_I_runtime_baseclasses_lump_cpp = Module["__GLOBAL__sub_I_runtime_baseclasses_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_baseclasses_lump_cpp"];
var __GLOBAL__sub_I_Console_cpp = Module["__GLOBAL__sub_I_Console_cpp"] = asm["__GLOBAL__sub_I_Console_cpp"];
var _bitshift64Ashr = Module["_bitshift64Ashr"] = asm["_bitshift64Ashr"];
var __GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp = Module["__GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_lump_cpp"];
var __GLOBAL__sub_I_GfxDeviceNull_cpp = Module["__GLOBAL__sub_I_GfxDeviceNull_cpp"] = asm["__GLOBAL__sub_I_GfxDeviceNull_cpp"];
var _sbrk = Module["_sbrk"] = asm["_sbrk"];
var _memcpy = Module["_memcpy"] = asm["_memcpy"];
var __GLOBAL__sub_I_GCHandle_cpp = Module["__GLOBAL__sub_I_GCHandle_cpp"] = asm["__GLOBAL__sub_I_GCHandle_cpp"];
var __GLOBAL__sub_I_Assembly_cpp = Module["__GLOBAL__sub_I_Assembly_cpp"] = asm["__GLOBAL__sub_I_Assembly_cpp"];
var __GLOBAL__sub_I_runtime_allocator2_lump_cpp = Module["__GLOBAL__sub_I_runtime_allocator2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_allocator2_lump_cpp"];
var __GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp = Module["__GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_webrequest_downloadhandler_lump_cpp"];
var __GLOBAL__sub_I_runtime_profiler_lump_cpp = Module["__GLOBAL__sub_I_runtime_profiler_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_profiler_lump_cpp"];
var ___udivmoddi4 = Module["___udivmoddi4"] = asm["___udivmoddi4"];
var __GLOBAL__sub_I_runtime_graphics5_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics5_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics5_lump_cpp"];
var __GLOBAL__sub_I_ProfilerImpl_cpp = Module["__GLOBAL__sub_I_ProfilerImpl_cpp"] = asm["__GLOBAL__sub_I_ProfilerImpl_cpp"];
var __GLOBAL__sub_I_runtime_audio2_lump_cpp = Module["__GLOBAL__sub_I_runtime_audio2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_audio2_lump_cpp"];
var __GLOBAL__sub_I_runtime_animation3_lump_cpp = Module["__GLOBAL__sub_I_runtime_animation3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_animation3_lump_cpp"];
var __GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp = Module["__GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp"] = asm["__GLOBAL__sub_I_modules_particleslegacy_private_lump_cpp"];
var __GLOBAL__sub_I_runtime_utilities3_lump_cpp = Module["__GLOBAL__sub_I_runtime_utilities3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_utilities3_lump_cpp"];
var __GLOBAL__sub_I_runtime_preloadmanager_lump_cpp = Module["__GLOBAL__sub_I_runtime_preloadmanager_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_preloadmanager_lump_cpp"];
var __GLOBAL__sub_I_SpriteRendererJobs_cpp = Module["__GLOBAL__sub_I_SpriteRendererJobs_cpp"] = asm["__GLOBAL__sub_I_SpriteRendererJobs_cpp"];
var __GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_mesh3_lump_cpp"];
var __GLOBAL__sub_I_TextMeshGenerator_cpp = Module["__GLOBAL__sub_I_TextMeshGenerator_cpp"] = asm["__GLOBAL__sub_I_TextMeshGenerator_cpp"];
var __GLOBAL__sub_I_GenericMethod_cpp = Module["__GLOBAL__sub_I_GenericMethod_cpp"] = asm["__GLOBAL__sub_I_GenericMethod_cpp"];
var __GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp = Module["__GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_serialize_transferfunctions_lump_cpp"];
var ___cxa_can_catch = Module["___cxa_can_catch"] = asm["___cxa_can_catch"];
var __GLOBAL__sub_I_runtime_graphics2_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics2_lump_cpp"];
var _free = Module["_free"] = asm["_free"];
var __GLOBAL__sub_I_SaveAndLoadHelper_cpp = Module["__GLOBAL__sub_I_SaveAndLoadHelper_cpp"] = asm["__GLOBAL__sub_I_SaveAndLoadHelper_cpp"];
var __GLOBAL__sub_I_AppDomain_cpp = Module["__GLOBAL__sub_I_AppDomain_cpp"] = asm["__GLOBAL__sub_I_AppDomain_cpp"];
var __GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp = Module["__GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_memoryfilesystem_lump_cpp"];
var _strstr = Module["_strstr"] = asm["_strstr"];
var __GLOBAL__sub_I_runtime_ui_lump_cpp = Module["__GLOBAL__sub_I_runtime_ui_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ui_lump_cpp"];
var __GLOBAL__sub_I_MetadataCache_cpp = Module["__GLOBAL__sub_I_MetadataCache_cpp"] = asm["__GLOBAL__sub_I_MetadataCache_cpp"];
var __GLOBAL__sub_I_CmEventProfiler_cpp = Module["__GLOBAL__sub_I_CmEventProfiler_cpp"] = asm["__GLOBAL__sub_I_CmEventProfiler_cpp"];
var _memalign = Module["_memalign"] = asm["_memalign"];
var __GLOBAL__sub_I_Environment_cpp = Module["__GLOBAL__sub_I_Environment_cpp"] = asm["__GLOBAL__sub_I_Environment_cpp"];
var __GLOBAL__sub_I_Socket_cpp = Module["__GLOBAL__sub_I_Socket_cpp"] = asm["__GLOBAL__sub_I_Socket_cpp"];
var __GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp = Module["__GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_shaders_gpuprograms_lump_cpp"];
var _SetFullscreen = Module["_SetFullscreen"] = asm["_SetFullscreen"];
var _main = Module["_main"] = asm["_main"];
var __GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp = Module["__GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_virtualfilesystem_archivefilesystem_lump_cpp"];
var __GLOBAL__sub_I_runtime_misc3_lump_cpp = Module["__GLOBAL__sub_I_runtime_misc3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_misc3_lump_cpp"];
var __GLOBAL__sub_I_runtime_core_callbacks_lump_cpp = Module["__GLOBAL__sub_I_runtime_core_callbacks_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_core_callbacks_lump_cpp"];
var __GLOBAL__sub_I_runtime_camera3_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera3_lump_cpp"];
var __GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp = Module["__GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ai_internal_crowd_lump_cpp"];
var __GLOBAL__sub_I_GUIText_cpp = Module["__GLOBAL__sub_I_GUIText_cpp"] = asm["__GLOBAL__sub_I_GUIText_cpp"];
var __GLOBAL__sub_I_runtime_graphics6_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics6_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics6_lump_cpp"];
var __GLOBAL__sub_I_umbra_cpp = Module["__GLOBAL__sub_I_umbra_cpp"] = asm["__GLOBAL__sub_I_umbra_cpp"];
var __GLOBAL__sub_I_PluginInterfaceVR_cpp = Module["__GLOBAL__sub_I_PluginInterfaceVR_cpp"] = asm["__GLOBAL__sub_I_PluginInterfaceVR_cpp"];
var __GLOBAL__sub_I_runtime_vehicles_lump_cpp = Module["__GLOBAL__sub_I_runtime_vehicles_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_vehicles_lump_cpp"];
var __GLOBAL__sub_I_VRGfxHelpers_cpp = Module["__GLOBAL__sub_I_VRGfxHelpers_cpp"] = asm["__GLOBAL__sub_I_VRGfxHelpers_cpp"];
var __GLOBAL__sub_I_runtime_network_lump_cpp = Module["__GLOBAL__sub_I_runtime_network_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_network_lump_cpp"];
var ___cxa_is_pointer_type = Module["___cxa_is_pointer_type"] = asm["___cxa_is_pointer_type"];
var _llvm_ctlz_i64 = Module["_llvm_ctlz_i64"] = asm["_llvm_ctlz_i64"];
var __GLOBAL__sub_I_runtime_physics2d_lump_cpp = Module["__GLOBAL__sub_I_runtime_physics2d_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_physics2d_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_lod_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_lod_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_lod_lump_cpp"];
var __GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp = Module["__GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp"] = asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime5_lump_cpp"];
var _llvm_cttz_i32 = Module["_llvm_cttz_i32"] = asm["_llvm_cttz_i32"];
var __GLOBAL__sub_I_TransformFeedbackSkinning_cpp = Module["__GLOBAL__sub_I_TransformFeedbackSkinning_cpp"] = asm["__GLOBAL__sub_I_TransformFeedbackSkinning_cpp"];
var __GLOBAL__sub_I_DirectorManager_cpp = Module["__GLOBAL__sub_I_DirectorManager_cpp"] = asm["__GLOBAL__sub_I_DirectorManager_cpp"];
var __GLOBAL__sub_I_RCW_cpp = Module["__GLOBAL__sub_I_RCW_cpp"] = asm["__GLOBAL__sub_I_RCW_cpp"];
var ___divdi3 = Module["___divdi3"] = asm["___divdi3"];
var __GLOBAL__sub_I_Interlocked_cpp = Module["__GLOBAL__sub_I_Interlocked_cpp"] = asm["__GLOBAL__sub_I_Interlocked_cpp"];
var _ntohs = Module["_ntohs"] = asm["_ntohs"];
var __GLOBAL__sub_I_runtime_ai_internal_lump_cpp = Module["__GLOBAL__sub_I_runtime_ai_internal_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ai_internal_lump_cpp"];
var __GLOBAL__sub_I_runtime_gfxdevice_lump_cpp = Module["__GLOBAL__sub_I_runtime_gfxdevice_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_gfxdevice_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_commandbuffer_lump_cpp"];
var __GLOBAL__sub_I_Player_cpp = Module["__GLOBAL__sub_I_Player_cpp"] = asm["__GLOBAL__sub_I_Player_cpp"];
var __GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp = Module["__GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_particlesystem_modules2_lump_cpp"];
var __GLOBAL__sub_I_MemoryManager_cpp = Module["__GLOBAL__sub_I_MemoryManager_cpp"] = asm["__GLOBAL__sub_I_MemoryManager_cpp"];
var __GLOBAL__sub_I_MemoryMappedFile_cpp = Module["__GLOBAL__sub_I_MemoryMappedFile_cpp"] = asm["__GLOBAL__sub_I_MemoryMappedFile_cpp"];
var __GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp = Module["__GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_particlesystem_modules3_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_billboard_lump_cpp"];
var _llvm_bswap_i32 = Module["_llvm_bswap_i32"] = asm["_llvm_bswap_i32"];
var __GLOBAL__sub_I_String_cpp = Module["__GLOBAL__sub_I_String_cpp"] = asm["__GLOBAL__sub_I_String_cpp"];
var __GLOBAL__sub_I_runtime_math_random_lump_cpp = Module["__GLOBAL__sub_I_runtime_math_random_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_math_random_lump_cpp"];
var __GLOBAL__sub_I_Reflection_cpp = Module["__GLOBAL__sub_I_Reflection_cpp"] = asm["__GLOBAL__sub_I_Reflection_cpp"];
var __GLOBAL__sub_I_SwSolverKernel_cpp = Module["__GLOBAL__sub_I_SwSolverKernel_cpp"] = asm["__GLOBAL__sub_I_SwSolverKernel_cpp"];
var __GLOBAL__sub_I_runtime_imgui_lump_cpp = Module["__GLOBAL__sub_I_runtime_imgui_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_imgui_lump_cpp"];
var _pthread_mutex_lock = Module["_pthread_mutex_lock"] = asm["_pthread_mutex_lock"];
var __GLOBAL__sub_I_runtime_serialize_lump_cpp = Module["__GLOBAL__sub_I_runtime_serialize_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_serialize_lump_cpp"];
var __GLOBAL__sub_I_runtime_jobs_lump_cpp = Module["__GLOBAL__sub_I_runtime_jobs_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_jobs_lump_cpp"];
var __GLOBAL__sub_I_ArrayMetadata_cpp = Module["__GLOBAL__sub_I_ArrayMetadata_cpp"] = asm["__GLOBAL__sub_I_ArrayMetadata_cpp"];
var _roundf = Module["_roundf"] = asm["_roundf"];
var __GLOBAL__sub_I_SizeByVelocityModule_cpp = Module["__GLOBAL__sub_I_SizeByVelocityModule_cpp"] = asm["__GLOBAL__sub_I_SizeByVelocityModule_cpp"];
var __GLOBAL__sub_I_runtime_mono_lump_cpp = Module["__GLOBAL__sub_I_runtime_mono_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_mono_lump_cpp"];
var runPostSets = Module["runPostSets"] = asm["runPostSets"];
var __GLOBAL__sub_I_runtime_misc_lump_cpp = Module["__GLOBAL__sub_I_runtime_misc_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_misc_lump_cpp"];
var __GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp = Module["__GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_mecanim_animation_lump_cpp"];
var __GLOBAL__sub_I_runtime_physics2d2_lump_cpp = Module["__GLOBAL__sub_I_runtime_physics2d2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_physics2d2_lump_cpp"];
var __GLOBAL__sub_I_LibraryLoader_cpp = Module["__GLOBAL__sub_I_LibraryLoader_cpp"] = asm["__GLOBAL__sub_I_LibraryLoader_cpp"];
var __GLOBAL__sub_I_runtime_terrain_lump_cpp = Module["__GLOBAL__sub_I_runtime_terrain_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_terrain_lump_cpp"];
var __GLOBAL__sub_I_runtime_assetbundles_lump_cpp = Module["__GLOBAL__sub_I_runtime_assetbundles_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_assetbundles_lump_cpp"];
var _SendMessageFloat = Module["_SendMessageFloat"] = asm["_SendMessageFloat"];
var __GLOBAL__sub_I_runtime_interfaces_lump_cpp = Module["__GLOBAL__sub_I_runtime_interfaces_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_interfaces_lump_cpp"];
var __GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp = Module["__GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ai_internal_builder_lump_cpp"];
var __GLOBAL__sub_I_runtime_scripting_lump_cpp = Module["__GLOBAL__sub_I_runtime_scripting_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_scripting_lump_cpp"];
var __GLOBAL__sub_I_runtime_2d_sorting_lump_cpp = Module["__GLOBAL__sub_I_runtime_2d_sorting_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_2d_sorting_lump_cpp"];
var __GLOBAL__sub_I_Assembly_cpp_63068 = Module["__GLOBAL__sub_I_Assembly_cpp_63068"] = asm["__GLOBAL__sub_I_Assembly_cpp_63068"];
var __GLOBAL__sub_I_runtime_dynamics_lump_cpp = Module["__GLOBAL__sub_I_runtime_dynamics_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_dynamics_lump_cpp"];
var __GLOBAL__sub_I_UnityAdsSettings_cpp = Module["__GLOBAL__sub_I_UnityAdsSettings_cpp"] = asm["__GLOBAL__sub_I_UnityAdsSettings_cpp"];
var _memset = Module["_memset"] = asm["_memset"];
var __GLOBAL__sub_I_runtime_utilities_lump_cpp = Module["__GLOBAL__sub_I_runtime_utilities_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_utilities_lump_cpp"];
var __GLOBAL__sub_I_StackTrace_cpp = Module["__GLOBAL__sub_I_StackTrace_cpp"] = asm["__GLOBAL__sub_I_StackTrace_cpp"];
var __GLOBAL__sub_I_runtime_geometry_lump_cpp = Module["__GLOBAL__sub_I_runtime_geometry_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_geometry_lump_cpp"];
var __GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera_renderloops_lump_cpp"];
var __GLOBAL__sub_I_runtime_allocator_lump_cpp = Module["__GLOBAL__sub_I_runtime_allocator_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_allocator_lump_cpp"];
var __GLOBAL__sub_I_runtime_profiler_internal_lump_cpp = Module["__GLOBAL__sub_I_runtime_profiler_internal_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_profiler_internal_lump_cpp"];
var _i64Subtract = Module["_i64Subtract"] = asm["_i64Subtract"];
var __GLOBAL__sub_I_runtime_gamecode_lump_cpp = Module["__GLOBAL__sub_I_runtime_gamecode_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_gamecode_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics4_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics4_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics4_lump_cpp"];
var __GLOBAL__sub_I_SwCollision_cpp = Module["__GLOBAL__sub_I_SwCollision_cpp"] = asm["__GLOBAL__sub_I_SwCollision_cpp"];
var __GLOBAL__sub_I_runtime_animation_lump_cpp = Module["__GLOBAL__sub_I_runtime_animation_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_animation_lump_cpp"];
var __GLOBAL__sub_I_runtime_shaders_lump_cpp = Module["__GLOBAL__sub_I_runtime_shaders_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_shaders_lump_cpp"];
var _llvm_bswap_i16 = Module["_llvm_bswap_i16"] = asm["_llvm_bswap_i16"];
var __GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp = Module["__GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_ai_internal_obstacles_lump_cpp"];
var __GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp = Module["__GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp"] = asm["__GLOBAL__sub_I_external_box2d_box2d_dynamics_lump_cpp"];
var ___remdi3 = Module["___remdi3"] = asm["___remdi3"];
var __GLOBAL__sub_I_ThreadImpl_cpp = Module["__GLOBAL__sub_I_ThreadImpl_cpp"] = asm["__GLOBAL__sub_I_ThreadImpl_cpp"];
var __GLOBAL__sub_I_Class_cpp = Module["__GLOBAL__sub_I_Class_cpp"] = asm["__GLOBAL__sub_I_Class_cpp"];
var __GLOBAL__sub_I_runtime_geometry2_lump_cpp = Module["__GLOBAL__sub_I_runtime_geometry2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_geometry2_lump_cpp"];
var _pthread_cond_broadcast = Module["_pthread_cond_broadcast"] = asm["_pthread_cond_broadcast"];
var __GLOBAL__sub_I_Image_cpp = Module["__GLOBAL__sub_I_Image_cpp"] = asm["__GLOBAL__sub_I_Image_cpp"];
var __GLOBAL__sub_I_runtime_modules_lump_cpp = Module["__GLOBAL__sub_I_runtime_modules_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_modules_lump_cpp"];
var __GLOBAL__sub_I_runtime_camera_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera_lump_cpp"];
var ___muldsi3 = Module["___muldsi3"] = asm["___muldsi3"];
var _testSetjmp = Module["_testSetjmp"] = asm["_testSetjmp"];
var __GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp = Module["__GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_particlesystem_modules_lump_cpp"];
var __GLOBAL__sub_I_SwSelfCollision_cpp = Module["__GLOBAL__sub_I_SwSelfCollision_cpp"] = asm["__GLOBAL__sub_I_SwSelfCollision_cpp"];
var ___cxx_global_var_init13 = Module["___cxx_global_var_init13"] = asm["___cxx_global_var_init13"];
var __GLOBAL__sub_I_Il2CppCodeRegistration_cpp = Module["__GLOBAL__sub_I_Il2CppCodeRegistration_cpp"] = asm["__GLOBAL__sub_I_Il2CppCodeRegistration_cpp"];
var _malloc = Module["_malloc"] = asm["_malloc"];
var __GLOBAL__sub_I_Runtime_cpp = Module["__GLOBAL__sub_I_Runtime_cpp"] = asm["__GLOBAL__sub_I_Runtime_cpp"];
var __GLOBAL__sub_I_runtime_misc2_lump_cpp = Module["__GLOBAL__sub_I_runtime_misc2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_misc2_lump_cpp"];
var __GLOBAL__sub_I_runtime_animation2_lump_cpp = Module["__GLOBAL__sub_I_runtime_animation2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_animation2_lump_cpp"];
var __GLOBAL__sub_I_runtime_dynamics2_lump_cpp = Module["__GLOBAL__sub_I_runtime_dynamics2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_dynamics2_lump_cpp"];
var __GLOBAL__sub_I_half_cpp = Module["__GLOBAL__sub_I_half_cpp"] = asm["__GLOBAL__sub_I_half_cpp"];
var __GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp = Module["__GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_gfxdevice2_lump_cpp"];
var _SendMessage = Module["_SendMessage"] = asm["_SendMessage"];
var __GLOBAL__sub_I_runtime_animation_director_lump_cpp = Module["__GLOBAL__sub_I_runtime_animation_director_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_animation_director_lump_cpp"];
var __GLOBAL__sub_I_runtime_particlesystem_lump_cpp = Module["__GLOBAL__sub_I_runtime_particlesystem_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_particlesystem_lump_cpp"];
var ___udivdi3 = Module["___udivdi3"] = asm["___udivdi3"];
var __GLOBAL__sub_I_VRDevice_cpp = Module["__GLOBAL__sub_I_VRDevice_cpp"] = asm["__GLOBAL__sub_I_VRDevice_cpp"];
var __GLOBAL__sub_I_Thread_cpp_62510 = Module["__GLOBAL__sub_I_Thread_cpp_62510"] = asm["__GLOBAL__sub_I_Thread_cpp_62510"];
var __GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp = Module["__GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp"] = asm["__GLOBAL__sub_I_platformdependent_webgl_source_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_scriptablerenderloop_lump_cpp"];
var __GLOBAL__sub_I_runtime_transform_lump_cpp = Module["__GLOBAL__sub_I_runtime_transform_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_transform_lump_cpp"];
var _InjectProfilerSample = Module["_InjectProfilerSample"] = asm["_InjectProfilerSample"];
var __GLOBAL__sub_I_runtime_terrain2_lump_cpp = Module["__GLOBAL__sub_I_runtime_terrain2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_terrain2_lump_cpp"];
var _bitshift64Shl = Module["_bitshift64Shl"] = asm["_bitshift64Shl"];
var __GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp = Module["__GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_mono_serializationbackend_directmemoryaccess_lump_cpp"];
var __GLOBAL__sub_I_runtime_input_lump_cpp = Module["__GLOBAL__sub_I_runtime_input_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_input_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_lump_cpp"];
var __GLOBAL__sub_I_runtime_audio_lump_cpp = Module["__GLOBAL__sub_I_runtime_audio_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_audio_lump_cpp"];
var __GLOBAL__sub_I_Thread_cpp = Module["__GLOBAL__sub_I_Thread_cpp"] = asm["__GLOBAL__sub_I_Thread_cpp"];
var ___cxx_global_var_init_2 = Module["___cxx_global_var_init_2"] = asm["___cxx_global_var_init_2"];
var __GLOBAL__sub_I_runtime_baseclasses2_lump_cpp = Module["__GLOBAL__sub_I_runtime_baseclasses2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_baseclasses2_lump_cpp"];
var __GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp = Module["__GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_graphics_mesh2_lump_cpp"];
var __GLOBAL__sub_I_runtime_terrainphysics_lump_cpp = Module["__GLOBAL__sub_I_runtime_terrainphysics_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_terrainphysics_lump_cpp"];
var __GLOBAL__sub_I_GarbageCollector_cpp = Module["__GLOBAL__sub_I_GarbageCollector_cpp"] = asm["__GLOBAL__sub_I_GarbageCollector_cpp"];
var ___muldi3 = Module["___muldi3"] = asm["___muldi3"];
var __GLOBAL__sub_I_SwInterCollision_cpp = Module["__GLOBAL__sub_I_SwInterCollision_cpp"] = asm["__GLOBAL__sub_I_SwInterCollision_cpp"];
var ___uremdi3 = Module["___uremdi3"] = asm["___uremdi3"];
var __GLOBAL__sub_I_runtime_scenemanager_lump_cpp = Module["__GLOBAL__sub_I_runtime_scenemanager_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_scenemanager_lump_cpp"];
var __GLOBAL__sub_I_GlslGpuProgramGLES_cpp = Module["__GLOBAL__sub_I_GlslGpuProgramGLES_cpp"] = asm["__GLOBAL__sub_I_GlslGpuProgramGLES_cpp"];
var _htonl = Module["_htonl"] = asm["_htonl"];
var _realloc = Module["_realloc"] = asm["_realloc"];
var _i64Add = Module["_i64Add"] = asm["_i64Add"];
var __GLOBAL__sub_I_runtime_logging_lump_cpp = Module["__GLOBAL__sub_I_runtime_logging_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_logging_lump_cpp"];
var _pthread_self = Module["_pthread_self"] = asm["_pthread_self"];
var _pthread_mutex_unlock = Module["_pthread_mutex_unlock"] = asm["_pthread_mutex_unlock"];
var __GLOBAL__sub_I_PxsFluidDynamics_cpp = Module["__GLOBAL__sub_I_PxsFluidDynamics_cpp"] = asm["__GLOBAL__sub_I_PxsFluidDynamics_cpp"];
var __GLOBAL__sub_I_runtime_utilities2_lump_cpp = Module["__GLOBAL__sub_I_runtime_utilities2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_utilities2_lump_cpp"];
var __GLOBAL__sub_I_runtime_video_lump_cpp_5815 = Module["__GLOBAL__sub_I_runtime_video_lump_cpp_5815"] = asm["__GLOBAL__sub_I_runtime_video_lump_cpp_5815"];
var __GLOBAL__sub_I_runtime_cloth_lump_cpp = Module["__GLOBAL__sub_I_runtime_cloth_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_cloth_lump_cpp"];
var _htons = Module["_htons"] = asm["_htons"];
var __GLOBAL__sub_I_runtime_application_lump_cpp = Module["__GLOBAL__sub_I_runtime_application_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_application_lump_cpp"];
var ___errno_location = Module["___errno_location"] = asm["___errno_location"];
var _SendMessageString = Module["_SendMessageString"] = asm["_SendMessageString"];
var _saveSetjmp = Module["_saveSetjmp"] = asm["_saveSetjmp"];
var __GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp = Module["__GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_shaders_shaderimpl_lump_cpp"];
var __GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp = Module["__GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp"] = asm["__GLOBAL__sub_I_platformdependent_webgl_source2_lump_cpp"];
var _memmove = Module["_memmove"] = asm["_memmove"];
var __GLOBAL__sub_I_runtime_unityconnect_lump_cpp = Module["__GLOBAL__sub_I_runtime_unityconnect_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_unityconnect_lump_cpp"];
var __GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera_renderloops2_lump_cpp"];
var __GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp = Module["__GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp"] = asm["__GLOBAL__sub_I_artifacts_generated_webgl_modules_imgui_lump_cpp"];
var __GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp = Module["__GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp"] = asm["__GLOBAL__sub_I_artifacts_generated_webgl_runtime4_lump_cpp"];
var __GLOBAL__sub_I_FontImpl_cpp = Module["__GLOBAL__sub_I_FontImpl_cpp"] = asm["__GLOBAL__sub_I_FontImpl_cpp"];
var __GLOBAL__sub_I_runtime_camera4_lump_cpp = Module["__GLOBAL__sub_I_runtime_camera4_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_camera4_lump_cpp"];
var __GLOBAL__sub_I_Error_cpp = Module["__GLOBAL__sub_I_Error_cpp"] = asm["__GLOBAL__sub_I_Error_cpp"];
var __GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp = Module["__GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp"] = asm["__GLOBAL__sub_I_runtime_network_playercommunicator_lump_cpp"];
var dynCall_viiifiii = Module["dynCall_viiifiii"] = asm["dynCall_viiifiii"];
var dynCall_diddi = Module["dynCall_diddi"] = asm["dynCall_diddi"];
var dynCall_fiff = Module["dynCall_fiff"] = asm["dynCall_fiff"];
var dynCall_fifi = Module["dynCall_fifi"] = asm["dynCall_fifi"];
var dynCall_iiiiiii = Module["dynCall_iiiiiii"] = asm["dynCall_iiiiiii"];
var dynCall_vifiiiiiiiiiiiiiiiiii = Module["dynCall_vifiiiiiiiiiiiiiiiiii"] = asm["dynCall_vifiiiiiiiiiiiiiiiiii"];
var dynCall_viiiiiiiiiii = Module["dynCall_viiiiiiiiiii"] = asm["dynCall_viiiiiiiiiii"];
var dynCall_fff = Module["dynCall_fff"] = asm["dynCall_fff"];
var dynCall_iidi = Module["dynCall_iidi"] = asm["dynCall_iidi"];
var dynCall_vff = Module["dynCall_vff"] = asm["dynCall_vff"];
var dynCall_fiiiiiifiiiiiif = Module["dynCall_fiiiiiifiiiiiif"] = asm["dynCall_fiiiiiifiiiiiif"];
var dynCall_iiiiifiif = Module["dynCall_iiiiifiif"] = asm["dynCall_iiiiifiif"];
var dynCall_iiiiifii = Module["dynCall_iiiiifii"] = asm["dynCall_iiiiifii"];
var dynCall_viiiiiffi = Module["dynCall_viiiiiffi"] = asm["dynCall_viiiiiffi"];
var dynCall_vfff = Module["dynCall_vfff"] = asm["dynCall_vfff"];
var dynCall_viifiiii = Module["dynCall_viifiiii"] = asm["dynCall_viifiiii"];
var dynCall_iiiiifiii = Module["dynCall_iiiiifiii"] = asm["dynCall_iiiiifiii"];
var dynCall_iiffi = Module["dynCall_iiffi"] = asm["dynCall_iiffi"];
var dynCall_vidd = Module["dynCall_vidd"] = asm["dynCall_vidd"];
var dynCall_iiiiiiiiiiii = Module["dynCall_iiiiiiiiiiii"] = asm["dynCall_iiiiiiiiiiii"];
var dynCall_iidiii = Module["dynCall_iidiii"] = asm["dynCall_iidiii"];
var dynCall_fif = Module["dynCall_fif"] = asm["dynCall_fif"];
var dynCall_viifiii = Module["dynCall_viifiii"] = asm["dynCall_viifiii"];
var dynCall_fii = Module["dynCall_fii"] = asm["dynCall_fii"];
var dynCall_viiiiiifiii = Module["dynCall_viiiiiifiii"] = asm["dynCall_viiiiiifiii"];
var dynCall_viiiiifii = Module["dynCall_viiiiifii"] = asm["dynCall_viiiiifii"];
var dynCall_di = Module["dynCall_di"] = asm["dynCall_di"];
var dynCall_viff = Module["dynCall_viff"] = asm["dynCall_viff"];
var dynCall_iiifiii = Module["dynCall_iiifiii"] = asm["dynCall_iiifiii"];
var dynCall_viiiiifi = Module["dynCall_viiiiifi"] = asm["dynCall_viiiiifi"];
var dynCall_viffff = Module["dynCall_viffff"] = asm["dynCall_viffff"];
var dynCall_didiii = Module["dynCall_didiii"] = asm["dynCall_didiii"];
var dynCall_viiffiii = Module["dynCall_viiffiii"] = asm["dynCall_viiffiii"];
var dynCall_dii = Module["dynCall_dii"] = asm["dynCall_dii"];
var dynCall_iifii = Module["dynCall_iifii"] = asm["dynCall_iifii"];
var dynCall_didi = Module["dynCall_didi"] = asm["dynCall_didi"];
var dynCall_iiiii = Module["dynCall_iiiii"] = asm["dynCall_iiiii"];
var dynCall_iidii = Module["dynCall_iidii"] = asm["dynCall_iidii"];
var dynCall_iiiiiiiiiiiiffffii = Module["dynCall_iiiiiiiiiiiiffffii"] = asm["dynCall_iiiiiiiiiiiiffffii"];
var dynCall_vdd = Module["dynCall_vdd"] = asm["dynCall_vdd"];
var dynCall_fiiifii = Module["dynCall_fiiifii"] = asm["dynCall_fiiifii"];
var dynCall_viffii = Module["dynCall_viffii"] = asm["dynCall_viffii"];
var dynCall_iiiiiiii = Module["dynCall_iiiiiiii"] = asm["dynCall_iiiiiiii"];
var dynCall_viiiiiiiiiiiiiii = Module["dynCall_viiiiiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiiiiii"];
var dynCall_difi = Module["dynCall_difi"] = asm["dynCall_difi"];
var dynCall_vdddddd = Module["dynCall_vdddddd"] = asm["dynCall_vdddddd"];
var dynCall_vifiiiiiiiiiiiii = Module["dynCall_vifiiiiiiiiiiiii"] = asm["dynCall_vifiiiiiiiiiiiii"];
var dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii = Module["dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiiii"];
var dynCall_viiifii = Module["dynCall_viiifii"] = asm["dynCall_viiifii"];
var dynCall_iiiiiiif = Module["dynCall_iiiiiiif"] = asm["dynCall_iiiiiiif"];
var dynCall_viiffii = Module["dynCall_viiffii"] = asm["dynCall_viiffii"];
var dynCall_iiiiiiiiii = Module["dynCall_iiiiiiiiii"] = asm["dynCall_iiiiiiiiii"];
var dynCall_fiffi = Module["dynCall_fiffi"] = asm["dynCall_fiffi"];
var dynCall_iiifii = Module["dynCall_iiifii"] = asm["dynCall_iiifii"];
var dynCall_viiiiiiiiiiiiiiiii = Module["dynCall_viiiiiiiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiiiiiiii"];
var dynCall_vffffffi = Module["dynCall_vffffffi"] = asm["dynCall_vffffffi"];
var dynCall_iiiiiiiiiiiiii = Module["dynCall_iiiiiiiiiiiiii"] = asm["dynCall_iiiiiiiiiiiiii"];
var dynCall_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii = Module["dynCall_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii"] = asm["dynCall_vifiiiiiiiiiiiiiiiiiiiiiiiiiiii"];
var dynCall_viffi = Module["dynCall_viffi"] = asm["dynCall_viffi"];
var dynCall_viiiifiiii = Module["dynCall_viiiifiiii"] = asm["dynCall_viiiifiiii"];
var dynCall_iiiifiiii = Module["dynCall_iiiifiiii"] = asm["dynCall_iiiifiiii"];
var dynCall_vifi = Module["dynCall_vifi"] = asm["dynCall_vifi"];
var dynCall_vifff = Module["dynCall_vifff"] = asm["dynCall_vifff"];
var dynCall_viiiiii = Module["dynCall_viiiiii"] = asm["dynCall_viiiiii"];
var dynCall_viiiiiiiiiiiiii = Module["dynCall_viiiiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiiiii"];
var dynCall_fiii = Module["dynCall_fiii"] = asm["dynCall_fiii"];
var dynCall_iiiiiifffiiifii = Module["dynCall_iiiiiifffiiifii"] = asm["dynCall_iiiiiifffiiifii"];
var dynCall_iifff = Module["dynCall_iifff"] = asm["dynCall_iifff"];
var dynCall_iifiii = Module["dynCall_iifiii"] = asm["dynCall_iifiii"];
var dynCall_fiif = Module["dynCall_fiif"] = asm["dynCall_fiif"];
var dynCall_iiiiifiiiif = Module["dynCall_iiiiifiiiif"] = asm["dynCall_iiiiifiiiif"];
var dynCall_fifffffi = Module["dynCall_fifffffi"] = asm["dynCall_fifffffi"];
var dynCall_viiiiiiiiii = Module["dynCall_viiiiiiiiii"] = asm["dynCall_viiiiiiiiii"];
var dynCall_iiiiiiffiiiiiiiiiffffiii = Module["dynCall_iiiiiiffiiiiiiiiiffffiii"] = asm["dynCall_iiiiiiffiiiiiiiiiffffiii"];
var dynCall_diii = Module["dynCall_diii"] = asm["dynCall_diii"];
var dynCall_fiffifi = Module["dynCall_fiffifi"] = asm["dynCall_fiffifi"];
var dynCall_iiiffi = Module["dynCall_iiiffi"] = asm["dynCall_iiiffi"];
var dynCall_viiififi = Module["dynCall_viiififi"] = asm["dynCall_viiififi"];
var dynCall_fiiii = Module["dynCall_fiiii"] = asm["dynCall_fiiii"];
var dynCall_iiiiii = Module["dynCall_iiiiii"] = asm["dynCall_iiiiii"];
var dynCall_viiiifii = Module["dynCall_viiiifii"] = asm["dynCall_viiiifii"];
var dynCall_iiiiffi = Module["dynCall_iiiiffi"] = asm["dynCall_iiiiffi"];
var dynCall_viiiiiiffii = Module["dynCall_viiiiiiffii"] = asm["dynCall_viiiiiiffii"];
var dynCall_viidii = Module["dynCall_viidii"] = asm["dynCall_viidii"];
var dynCall_viiiififi = Module["dynCall_viiiififi"] = asm["dynCall_viiiififi"];
var dynCall_iiiiiifiif = Module["dynCall_iiiiiifiif"] = asm["dynCall_iiiiiifiif"];
var dynCall_viiii = Module["dynCall_viiii"] = asm["dynCall_viiii"];
var dynCall_viiiii = Module["dynCall_viiiii"] = asm["dynCall_viiiii"];
var dynCall_viifii = Module["dynCall_viifii"] = asm["dynCall_viifii"];
var dynCall_iifffi = Module["dynCall_iifffi"] = asm["dynCall_iifffi"];
var dynCall_vif = Module["dynCall_vif"] = asm["dynCall_vif"];
var dynCall_vid = Module["dynCall_vid"] = asm["dynCall_vid"];
var dynCall_vii = Module["dynCall_vii"] = asm["dynCall_vii"];
var dynCall_iiiiifiiii = Module["dynCall_iiiiifiiii"] = asm["dynCall_iiiiifiiii"];
var dynCall_iiffiii = Module["dynCall_iiffiii"] = asm["dynCall_iiffiii"];
var dynCall_fi = Module["dynCall_fi"] = asm["dynCall_fi"];
var dynCall_viidi = Module["dynCall_viidi"] = asm["dynCall_viidi"];
var dynCall_viifif = Module["dynCall_viifif"] = asm["dynCall_viifif"];
var dynCall_vf = Module["dynCall_vf"] = asm["dynCall_vf"];
var dynCall_iiiiiiffiiiiiiiiiiiiiii = Module["dynCall_iiiiiiffiiiiiiiiiiiiiii"] = asm["dynCall_iiiiiiffiiiiiiiiiiiiiii"];
var dynCall_fiiiiiiiifiiiif = Module["dynCall_fiiiiiiiifiiiif"] = asm["dynCall_fiiiiiiiifiiiif"];
var dynCall_iiffii = Module["dynCall_iiffii"] = asm["dynCall_iiffii"];
var dynCall_viiffffffi = Module["dynCall_viiffffffi"] = asm["dynCall_viiffffffi"];
var dynCall_viffffii = Module["dynCall_viffffii"] = asm["dynCall_viffffii"];
var dynCall_vifiii = Module["dynCall_vifiii"] = asm["dynCall_vifiii"];
var dynCall_diiii = Module["dynCall_diiii"] = asm["dynCall_diiii"];
var dynCall_iiifiiii = Module["dynCall_iiifiiii"] = asm["dynCall_iiifiiii"];
var dynCall_viiiiiiiiiiiii = Module["dynCall_viiiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiiii"];
var dynCall_viffffffii = Module["dynCall_viffffffii"] = asm["dynCall_viffffffii"];
var dynCall_iiiiiiiiiiffffii = Module["dynCall_iiiiiiiiiiffffii"] = asm["dynCall_iiiiiiiiiiffffii"];
var dynCall_iiiiifi = Module["dynCall_iiiiifi"] = asm["dynCall_iiiiifi"];
var dynCall_iiiiiffi = Module["dynCall_iiiiiffi"] = asm["dynCall_iiiiiffi"];
var dynCall_fifii = Module["dynCall_fifii"] = asm["dynCall_fifii"];
var dynCall_viiiiiiii = Module["dynCall_viiiiiiii"] = asm["dynCall_viiiiiiii"];
var dynCall_fiffifffi = Module["dynCall_fiffifffi"] = asm["dynCall_fiffifffi"];
var dynCall_iif = Module["dynCall_iif"] = asm["dynCall_iif"];
var dynCall_didii = Module["dynCall_didii"] = asm["dynCall_didii"];
var dynCall_viiiiiii = Module["dynCall_viiiiiii"] = asm["dynCall_viiiiiii"];
var dynCall_vifii = Module["dynCall_vifii"] = asm["dynCall_vifii"];
var dynCall_viiiiiiiii = Module["dynCall_viiiiiiiii"] = asm["dynCall_viiiiiiiii"];
var dynCall_iii = Module["dynCall_iii"] = asm["dynCall_iii"];
var dynCall_fiiiif = Module["dynCall_fiiiif"] = asm["dynCall_fiiiif"];
var dynCall_iiiifii = Module["dynCall_iiiifii"] = asm["dynCall_iiiifii"];
var dynCall_f = Module["dynCall_f"] = asm["dynCall_f"];
var dynCall_vffff = Module["dynCall_vffff"] = asm["dynCall_vffff"];
var dynCall_iiiiiifi = Module["dynCall_iiiiiifi"] = asm["dynCall_iiiiiifi"];
var dynCall_viiiifiiiiif = Module["dynCall_viiiifiiiiif"] = asm["dynCall_viiiifiiiiif"];
var dynCall_viififi = Module["dynCall_viififi"] = asm["dynCall_viififi"];
var dynCall_viii = Module["dynCall_viii"] = asm["dynCall_viii"];
var dynCall_viiiifi = Module["dynCall_viiiifi"] = asm["dynCall_viiiifi"];
var dynCall_v = Module["dynCall_v"] = asm["dynCall_v"];
var dynCall_viif = Module["dynCall_viif"] = asm["dynCall_viif"];
var dynCall_fiiifi = Module["dynCall_fiiifi"] = asm["dynCall_fiiifi"];
var dynCall_iiiifi = Module["dynCall_iiiifi"] = asm["dynCall_iiiifi"];
var dynCall_vd = Module["dynCall_vd"] = asm["dynCall_vd"];
var dynCall_fiifi = Module["dynCall_fiifi"] = asm["dynCall_fiifi"];
var dynCall_vi = Module["dynCall_vi"] = asm["dynCall_vi"];
var dynCall_iiiiiiiiiii = Module["dynCall_iiiiiiiiiii"] = asm["dynCall_iiiiiiiiiii"];
var dynCall_iiiiiiiffiiiiiiiiiffffiiii = Module["dynCall_iiiiiiiffiiiiiiiiiffffiiii"] = asm["dynCall_iiiiiiiffiiiiiiiiiffffiiii"];
var dynCall_ii = Module["dynCall_ii"] = asm["dynCall_ii"];
var dynCall_vifffi = Module["dynCall_vifffi"] = asm["dynCall_vifffi"];
var dynCall_viifi = Module["dynCall_viifi"] = asm["dynCall_viifi"];
var dynCall_iiiiifiiiiii = Module["dynCall_iiiiifiiiiii"] = asm["dynCall_iiiiifiiiiii"];
var dynCall_iiiiifiiiiif = Module["dynCall_iiiiifiiiiif"] = asm["dynCall_iiiiifiiiiif"];
var dynCall_viiff = Module["dynCall_viiff"] = asm["dynCall_viiff"];
var dynCall_viiiiiiiiiiii = Module["dynCall_viiiiiiiiiiii"] = asm["dynCall_viiiiiiiiiiii"];
var dynCall_iifi = Module["dynCall_iifi"] = asm["dynCall_iifi"];
var dynCall_viiif = Module["dynCall_viiif"] = asm["dynCall_viiif"];
var dynCall_fifffi = Module["dynCall_fifffi"] = asm["dynCall_fifffi"];
var dynCall_vifiiiiiiiiiiiiiiiiiiiiiii = Module["dynCall_vifiiiiiiiiiiiiiiiiiiiiiii"] = asm["dynCall_vifiiiiiiiiiiiiiiiiiiiiiii"];
var dynCall_iiiffii = Module["dynCall_iiiffii"] = asm["dynCall_iiiffii"];
var dynCall_iiifi = Module["dynCall_iiifi"] = asm["dynCall_iiifi"];
var dynCall_iiii = Module["dynCall_iiii"] = asm["dynCall_iiii"];
var dynCall_fidi = Module["dynCall_fidi"] = asm["dynCall_fidi"];
var dynCall_viifff = Module["dynCall_viifff"] = asm["dynCall_viifff"];
var dynCall_viiffi = Module["dynCall_viiffi"] = asm["dynCall_viiffi"];
var dynCall_iiif = Module["dynCall_iiif"] = asm["dynCall_iiif"];
var dynCall_viiiffi = Module["dynCall_viiiffi"] = asm["dynCall_viiiffi"];
var dynCall_diiiii = Module["dynCall_diiiii"] = asm["dynCall_diiiii"];
var dynCall_viiiififfi = Module["dynCall_viiiififfi"] = asm["dynCall_viiiififfi"];
var dynCall_viiifi = Module["dynCall_viiifi"] = asm["dynCall_viiifi"];
var dynCall_fiiffi = Module["dynCall_fiiffi"] = asm["dynCall_fiiffi"];
var dynCall_iiiiiiffiiiiiiiiiffffiiii = Module["dynCall_iiiiiiffiiiiiiiiiffffiiii"] = asm["dynCall_iiiiiiffiiiiiiiiiffffiiii"];
var dynCall_iiiiiiiiiiiii = Module["dynCall_iiiiiiiiiiiii"] = asm["dynCall_iiiiiiiiiiiii"];
var dynCall_viifffi = Module["dynCall_viifffi"] = asm["dynCall_viifffi"];
var dynCall_vifffii = Module["dynCall_vifffii"] = asm["dynCall_vifffii"];
var dynCall_iiiifiii = Module["dynCall_iiiifiii"] = asm["dynCall_iiiifiii"];
var dynCall_ff = Module["dynCall_ff"] = asm["dynCall_ff"];
var dynCall_iiiifiiiii = Module["dynCall_iiiifiiiii"] = asm["dynCall_iiiifiiiii"];
var dynCall_iiiiiiiiiiiiiii = Module["dynCall_iiiiiiiiiiiiiii"] = asm["dynCall_iiiiiiiiiiiiiii"];
var dynCall_iiififfi = Module["dynCall_iiififfi"] = asm["dynCall_iiififfi"];
var dynCall_vfi = Module["dynCall_vfi"] = asm["dynCall_vfi"];
var dynCall_i = Module["dynCall_i"] = asm["dynCall_i"];
var dynCall_iiidii = Module["dynCall_iiidii"] = asm["dynCall_iiidii"];
var dynCall_viiifiiiii = Module["dynCall_viiifiiiii"] = asm["dynCall_viiifiiiii"];
var dynCall_viiiiifffi = Module["dynCall_viiiiifffi"] = asm["dynCall_viiiiifffi"];
var dynCall_vidi = Module["dynCall_vidi"] = asm["dynCall_vidi"];
var dynCall_iiiiiiiii = Module["dynCall_iiiiiiiii"] = asm["dynCall_iiiiiiiii"];
var dynCall_vifiiii = Module["dynCall_vifiiii"] = asm["dynCall_vifiiii"];
var dynCall_viffffi = Module["dynCall_viffffi"] = asm["dynCall_viffffi"];
Runtime.stackAlloc = asm["stackAlloc"];
Runtime.stackSave = asm["stackSave"];
Runtime.stackRestore = asm["stackRestore"];
Runtime.establishStackSpace = asm["establishStackSpace"];
Runtime.setTempRet0 = asm["setTempRet0"];
Runtime.getTempRet0 = asm["getTempRet0"];
if (memoryInitializer) {
 if (typeof Module["locateFile"] === "function") {
  memoryInitializer = Module["locateFile"](memoryInitializer);
 } else if (Module["memoryInitializerPrefixURL"]) {
  memoryInitializer = Module["memoryInitializerPrefixURL"] + memoryInitializer;
 }
 if (ENVIRONMENT_IS_NODE || ENVIRONMENT_IS_SHELL) {
  var data = Module["readBinary"](memoryInitializer);
  HEAPU8.set(data, Runtime.GLOBAL_BASE);
 } else {
  addRunDependency("memory initializer");
  var applyMemoryInitializer = (function(data) {
   if (data.byteLength) data = new Uint8Array(data);
   for (var i = 0; i < data.length; i++) {
    assert(HEAPU8[Runtime.GLOBAL_BASE + i] === 0, "area for memory initializer should not have been touched before it's loaded");
   }
   HEAPU8.set(data, Runtime.GLOBAL_BASE);
   if (Module["memoryInitializerRequest"]) delete Module["memoryInitializerRequest"].response;
   removeRunDependency("memory initializer");
  });
  function doBrowserLoad() {
   Module["readAsync"](memoryInitializer, applyMemoryInitializer, (function() {
    throw "could not load memory initializer " + memoryInitializer;
   }));
  }
  if (Module["memoryInitializerRequest"]) {
   function useRequest() {
    var request = Module["memoryInitializerRequest"];
    if (request.status !== 200 && request.status !== 0) {
     console.warn("a problem seems to have happened with Module.memoryInitializerRequest, status: " + request.status + ", retrying " + memoryInitializer);
     doBrowserLoad();
     return;
    }
    applyMemoryInitializer(request.response);
   }
   if (Module["memoryInitializerRequest"].response) {
    setTimeout(useRequest, 0);
   } else {
    Module["memoryInitializerRequest"].addEventListener("load", useRequest);
   }
  } else {
   doBrowserLoad();
  }
 }
}
function ExitStatus(status) {
 this.name = "ExitStatus";
 this.message = "Program terminated with exit(" + status + ")";
 this.status = status;
}
ExitStatus.prototype = new Error;
ExitStatus.prototype.constructor = ExitStatus;
var initialStackTop;
var preloadStartTime = null;
var calledMain = false;
dependenciesFulfilled = function runCaller() {
 if (!Module["calledRun"]) run();
 if (!Module["calledRun"]) dependenciesFulfilled = runCaller;
};
Module["callMain"] = Module.callMain = function callMain(args) {
 assert(runDependencies == 0, "cannot call main when async dependencies remain! (listen on __ATMAIN__)");
 assert(__ATPRERUN__.length == 0, "cannot call main when preRun functions remain to be called");
 args = args || [];
 ensureInitRuntime();
 var argc = args.length + 1;
 function pad() {
  for (var i = 0; i < 4 - 1; i++) {
   argv.push(0);
  }
 }
 var argv = [ allocate(intArrayFromString(Module["thisProgram"]), "i8", ALLOC_NORMAL) ];
 pad();
 for (var i = 0; i < argc - 1; i = i + 1) {
  argv.push(allocate(intArrayFromString(args[i]), "i8", ALLOC_NORMAL));
  pad();
 }
 argv.push(0);
 argv = allocate(argv, "i32", ALLOC_NORMAL);
 try {
  var ret = Module["_main"](argc, argv, 0);
  exit(ret, true);
 } catch (e) {
  if (e instanceof ExitStatus) {
   return;
  } else if (e == "SimulateInfiniteLoop") {
   Module["noExitRuntime"] = true;
   return;
  } else {
   if (e && typeof e === "object" && e.stack) Module.printErr("exception thrown: " + [ e, e.stack ]);
   throw e;
  }
 } finally {
  calledMain = true;
 }
};
function run(args) {
 args = args || Module["arguments"];
 if (preloadStartTime === null) preloadStartTime = Date.now();
 if (runDependencies > 0) {
  Module.printErr("run() called, but dependencies remain, so not running");
  return;
 }
 writeStackCookie();
 preRun();
 if (runDependencies > 0) return;
 if (Module["calledRun"]) return;
 function doRun() {
  if (Module["calledRun"]) return;
  Module["calledRun"] = true;
  if (ABORT) return;
  ensureInitRuntime();
  preMain();
  if (ENVIRONMENT_IS_WEB && preloadStartTime !== null) {
   Module.printErr("pre-main prep time: " + (Date.now() - preloadStartTime) + " ms");
  }
  if (Module["onRuntimeInitialized"]) Module["onRuntimeInitialized"]();
  if (Module["_main"] && shouldRunNow) Module["callMain"](args);
  postRun();
 }
 if (Module["setStatus"]) {
  Module["setStatus"]("Running...");
  setTimeout((function() {
   setTimeout((function() {
    Module["setStatus"]("");
   }), 1);
   doRun();
  }), 1);
 } else {
  doRun();
 }
 checkStackCookie();
}
Module["run"] = Module.run = run;
function exit(status, implicit) {
 if (implicit && Module["noExitRuntime"]) {
  Module.printErr("exit(" + status + ") implicitly called by end of main(), but noExitRuntime, so not exiting the runtime (you can use emscripten_force_exit, if you want to force a true shutdown)");
  return;
 }
 if (Module["noExitRuntime"]) {
  Module.printErr("exit(" + status + ") called, but noExitRuntime, so halting execution but not exiting the runtime or preventing further async execution (you can use emscripten_force_exit, if you want to force a true shutdown)");
 } else {
  ABORT = true;
  EXITSTATUS = status;
  STACKTOP = initialStackTop;
  exitRuntime();
  if (Module["onExit"]) Module["onExit"](status);
 }
 if (ENVIRONMENT_IS_NODE) {
  process["exit"](status);
 } else if (ENVIRONMENT_IS_SHELL && typeof quit === "function") {
  quit(status);
 }
 throw new ExitStatus(status);
}
Module["exit"] = Module.exit = exit;
var abortDecorators = [];
function abort(what) {
 if (what !== undefined) {
  Module.print(what);
  Module.printErr(what);
  what = JSON.stringify(what);
 } else {
  what = "";
 }
 ABORT = true;
 EXITSTATUS = 1;
 var extra = "";
 var output = "abort(" + what + ") at " + stackTrace() + extra;
 if (abortDecorators) {
  abortDecorators.forEach((function(decorator) {
   output = decorator(output, what);
  }));
 }
 throw output;
}
Module["abort"] = Module.abort = abort;
if (Module["preInit"]) {
 if (typeof Module["preInit"] == "function") Module["preInit"] = [ Module["preInit"] ];
 while (Module["preInit"].length > 0) {
  Module["preInit"].pop()();
 }
}
var shouldRunNow = true;
if (Module["noInitialRun"]) {
 shouldRunNow = false;
}
Module["noExitRuntime"] = true;
run();




