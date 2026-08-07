import { drawRgbaFrame } from "../runtime/vapoursynth/client.mjs";
import { PyodideWorkerClient } from "../runtime/pyodide/client.mjs";

const CORE_LIBRARY = Object.freeze([
  { group: "Clip creation", kind: "video", names: ["BlankClip", "AddBorders", "AssumeFPS", "Loop", "Reverse", "Trim"] },
  { group: "Geometry & sequence", kind: "video", names: ["Crop", "CropAbs", "FlipHorizontal", "FlipVertical", "Bilinear", "Bicubic", "Point", "Lanczos", "Spline16", "Spline36", "Spline64", "Bob", "Transpose", "Turn90", "Turn180", "Turn270", "StackHorizontal", "StackVertical", "Splice", "Interleave", "SelectEvery", "SeparateFields", "DoubleWeave", "DeleteFrames", "DuplicateFrames", "FreezeFrames"] },
  { group: "Expression & colour", kind: "video", names: ["Expr", "Invert", "InvertMask", "Levels", "Limiter", "Lut", "Lut2", "MakeDiff", "MakeFullDiff", "MergeDiff", "MergeFullDiff", "PreMultiply", "ShufflePlanes", "SplitPlanes"] },
  { group: "Compositing", kind: "video", names: ["Merge", "MaskedMerge", "CopyFrameProps", "ClipToProp", "PropToClip"] },
  { group: "Analysis & morphology", kind: "video", names: ["AverageFrames", "Binarize", "BinarizeMask", "BoxBlur", "Convolution", "Deflate", "Inflate", "Maximum", "Median", "Minimum", "PEMVerifier", "PlaneStats", "Prewitt", "Sobel"] },
  { group: "Frame properties", kind: "video", names: ["FrameEval", "ModifyFrame", "RemoveFrameProps", "SetFieldBased", "SetFrameProp", "SetFrameProps", "SetVideoCache"] },
  { group: "Text overlays", kind: "video", names: ["ClipInfo", "CoreInfo", "FrameNum", "FrameProps", "Text"] },
  { group: "Core administration", kind: "general", names: ["LoadAllPlugins", "LoadPlugin", "LoadPluginAvisynth", "SetMaxCPU"] },
  { group: "Audio", kind: "audio", names: ["AssumeSampleRate", "AudioGain", "AudioLoop", "AudioMix", "AudioResample", "AudioReverse", "AudioSplice", "AudioTrim", "BlankAudio", "SetAudioCache", "ShuffleChannels", "SplitChannels"] },
]);

const VECTOR_VALIDATED_FUNCTIONS = new Set([
  "AddBorders", "BlankClip", "Crop", "Expr", "FlipHorizontal", "FlipVertical", "Invert", "Levels", "Lut", "Maximum", "Median", "Minimum", "ShufflePlanes", "StackHorizontal", "StackVertical", "Transpose", "Turn180",
]);

const PYTHON_KEYWORDS = new Set([
  "and", "as", "assert", "async", "await", "break", "case", "class", "continue", "def", "del",
  "elif", "else", "except", "finally", "for", "from", "global", "if", "import", "in", "is",
  "lambda", "match", "nonlocal", "not", "or", "pass", "raise", "return", "try", "while", "with",
  "yield",
]);

const RESIZE_ARGUMENTS = "vnode clip[, int width, int height, int format, enum matrix, enum transfer, enum primaries, enum range, enum chromaloc, enum matrix_in, enum transfer_in, enum primaries_in, enum range_in, enum chromaloc_in, float filter_param_a, float filter_param_b, string resample_filter_uv, float filter_param_a_uv, float filter_param_b_uv, string dither_type=\"none\", string cpu_type, float src_left, float src_top, float src_width, float src_height, float nominal_luminance, bint approximate_gamma=True, bint chromatic_adaptation=True]";
const FILTER_SIGNATURES = Object.freeze({
  BlankClip: "BlankClip([vnode clip, int width=640, int height=480, int format=vs.RGB24, int length=(10*fpsnum)/fpsden, int fpsnum=24, int fpsden=1, float[] color=<black>, bint keep=0, bint varsize=0, bint varformat=0])",
  AddBorders: "AddBorders(vnode clip[, int left=0, int right=0, int top=0, int bottom=0, float[] color=<black>])",
  AssumeFPS: "AssumeFPS(vnode clip[, vnode src, int fpsnum, int fpsden=1])",
  Loop: "Loop(vnode clip[, int times=0])",
  Reverse: "Reverse(vnode clip)",
  Trim: "Trim(vnode clip[, int first=0, int last, int length])",
  Crop: "Crop(vnode clip[, int left=0, int right=0, int top=0, int bottom=0])",
  CropAbs: "CropAbs(vnode clip, int width, int height[, int left=0, int top=0])",
  FlipHorizontal: "FlipHorizontal(vnode clip)",
  FlipVertical: "FlipVertical(vnode clip)",
  Bilinear: `Bilinear(${RESIZE_ARGUMENTS})`,
  Bicubic: "Bicubic(vnode clip[, ...])",
  Point: "Point(vnode clip[, ...])",
  Lanczos: "Lanczos(vnode clip[, ...])",
  Spline16: "Spline16(vnode clip[, ...])",
  Spline36: "Spline36(vnode clip[, ...])",
  Spline64: "Spline64(vnode clip[, ...])",
  Bob: "Bob(vnode clip[, string filter=\"bicubic\", bint tff, ...])",
  Transpose: "Transpose(vnode clip)",
  Turn90: "Turn90(vnode clip)",
  Turn180: "Turn180(vnode clip)",
  Turn270: "Turn270(vnode clip)",
  StackHorizontal: "StackHorizontal(vnode[] clips)",
  StackVertical: "StackVertical(vnode[] clips)",
  Splice: "Splice(vnode[] clips[, bint mismatch=0])",
  Interleave: "Interleave(vnode[] clips[, bint extend=0, bint mismatch=0, bint modify_duration=True])",
  SelectEvery: "SelectEvery(vnode clip, int cycle, int[] offsets[, bint modify_duration=True])",
  SeparateFields: "SeparateFields(vnode clip[, bint tff, bint modify_duration=True])",
  DoubleWeave: "DoubleWeave(vnode clip[, bint tff])",
  DeleteFrames: "DeleteFrames(vnode clip, int[] frames)",
  DuplicateFrames: "DuplicateFrames(vnode clip, int[] frames)",
  FreezeFrames: "FreezeFrames(vnode clip, int[] first, int[] last, int[] replacement)",
  Expr: "Expr(vnode[] clips, string[] expr[, int format])",
  Invert: "Invert(vnode clip[, int[] planes=[0,1,2]])",
  InvertMask: "InvertMask(vnode clip[, int[] planes=[0,1,2]])",
  Levels: "Levels(vnode clip[, float[] min_in, float[] max_in, float[] gamma=1.0, float[] min_out, float[] max_out, int[] planes=[0,1,2]])",
  Limiter: "Limiter(vnode clip[, float[] min, float[] max, int[] planes=[0,1,2]])",
  Lut: "Lut(vnode clip[, int[] planes, int[] lut, float[] lutf, func function, int bits, bint floatout])",
  Lut2: "Lut2(vnode clipa, vnode clipb[, int[] planes, int[] lut, float[] lutf, func function, int bits, bint floatout])",
  MakeDiff: "MakeDiff(vnode clipa, vnode clipb[, int[] planes])",
  MakeFullDiff: "MakeFullDiff(vnode clipa, vnode clipb)",
  MergeDiff: "MergeDiff(vnode clipa, vnode clipb[, int[] planes])",
  MergeFullDiff: "MergeFullDiff(vnode clipa, vnode clipb)",
  PreMultiply: "PreMultiply(vnode clip, vnode alpha)",
  ShufflePlanes: "ShufflePlanes(vnode[] clips, int[] planes, int colorfamily[, vnode prop_src=clips[0]])",
  SplitPlanes: "SplitPlanes(vnode clip)",
  Merge: "Merge(vnode clipa, vnode clipb[, float[] weight=0.5])",
  MaskedMerge: "MaskedMerge(vnode clipa, vnode clipb, vnode mask[, int[] planes, bint first_plane=0, bint premultiplied=0])",
  CopyFrameProps: "CopyFrameProps(vnode clip, vnode prop_src[, string[] props])",
  ClipToProp: "ClipToProp(vnode clip, vnode mclip[, string prop='_Alpha'])",
  PropToClip: "PropToClip(vnode clip[, string prop='_Alpha', int index=0])",
  AverageFrames: "AverageFrames(vnode[] clips, float[] weights[, float scale, bint scenechange, int[] planes])",
  Binarize: "Binarize(vnode clip[, float[] threshold, float[] v0, float[] v1, int[] planes=[0,1,2]])",
  BinarizeMask: "BinarizeMask(vnode clip[, float[] threshold, float[] v0, float[] v1, int[] planes=[0,1,2]])",
  BoxBlur: "BoxBlur(vnode clip[, int[] planes, int hradius=1, int hpasses=1, int vradius=1, int vpasses=1])",
  Convolution: "Convolution(vnode clip, float[] matrix[, float bias=0.0, float divisor=0.0, int[] planes=[0,1,2], bint saturate=True, string mode=\"s\"])",
  Deflate: "Deflate(vnode clip[, int[] planes=[0,1,2], float threshold])",
  Inflate: "Inflate(vnode clip[, int[] planes=[0,1,2], float threshold])",
  Maximum: "Maximum(vnode clip[, int[] planes, float threshold, bint[] coordinates=[1,1,1,1,1,1,1,1]])",
  Median: "Median(vnode clip[, int[] planes=[0,1,2]])",
  Minimum: "Minimum(vnode clip[, int[] planes, float threshold, bint[] coordinates=[1,1,1,1,1,1,1,1]])",
  PEMVerifier: "PEMVerifier(vnode clip[, float[] upper, float[] lower])",
  PlaneStats: "PlaneStats(vnode clipa[, vnode clipb, int plane=0, string prop='PlaneStats'])",
  Prewitt: "Prewitt(vnode clip[, int[] planes=[0,1,2], float scale=1])",
  Sobel: "Sobel(vnode clip[, int[] planes=[0,1,2], float scale=1])",
  FrameEval: "FrameEval(vnode clip, func eval[, vnode[] prop_src, vnode[] clip_src])",
  ModifyFrame: "ModifyFrame(vnode clip, clip[] clips, func selector)",
  RemoveFrameProps: "RemoveFrameProps(vnode clip[, string props[]])",
  SetFieldBased: "SetFieldBased(vnode clip, int value)",
  SetFrameProp: "SetFrameProp(vnode clip, string prop[, int[] intval, float[] floatval, string[] data])",
  SetFrameProps: "SetFrameProps(vnode clip, ...)",
  SetVideoCache: "SetVideoCache(vnode clip[, int mode, int fixedsize, int maxsize, int maxhistory])",
  ClipInfo: "ClipInfo(vnode clip[, int alignment=7, int scale=1])",
  CoreInfo: "CoreInfo([vnode clip=std.BlankClip(), int alignment=7, int scale=1])",
  FrameNum: "FrameNum(vnode clip[, int alignment=7, int scale=1])",
  FrameProps: "FrameProps(vnode clip[, string[] props, int alignment=7, int scale=1])",
  Text: "Text(vnode clip, string text[, int alignment=7, int scale=1])",
  LoadAllPlugins: "LoadAllPlugins(string path)",
  LoadPlugin: "LoadPlugin(string path, bint altsearchpath=False)",
  LoadPluginAvisynth: "LoadPlugin(string path)",
  SetMaxCPU: "SetMaxCPU(string cpu)",
  AssumeSampleRate: "AssumeSampleRate(anode clip[, anode src, int samplerate])",
  AudioGain: "AudioGain(anode clip, float[] gain, bint overflow_error=False)",
  AudioLoop: "AudioLoop(anode clip[, int times=0])",
  AudioMix: "AudioMix(anode[] clips, float[] matrix, int[] channels_out, bint overflow_error=False)",
  AudioResample: "AudioResample(anode clip[, int samplerate, int sampletype, int bits, int[] channels, string dither_type=\"triangular\", bint normalize, bint overflow_error=False])",
  AudioReverse: "AudioReverse(anode clip)",
  AudioSplice: "AudioSplice(anode[] clips)",
  AudioTrim: "AudioTrim(anode clip[, int first=0, int last, int length])",
  BlankAudio: "BlankAudio([anode clip, int[] channels=[FRONT_LEFT,FRONT_RIGHT], int bits=16, int sampletype=INTEGER, int samplerate=44100, int length=(10*samplerate), bint keep=0, string waveform=\"none\", float amplitude=1.0, float frequency=440.0])",
  SetAudioCache: "SetAudioCache(anode clip[, int mode, int fixedsize, int maxsize, int maxhistory])",
  ShuffleChannels: "ShuffleChannels(anode[] clips, int[] channels_in, int[] channels_out)",
  SplitChannels: "SplitChannels(anode clip)",
});

const FILTER_NAMESPACES = Object.freeze({
  Bilinear: "resize", Bicubic: "resize", Point: "resize", Lanczos: "resize", Spline16: "resize", Spline36: "resize", Spline64: "resize", Bob: "resize",
  ClipInfo: "text", CoreInfo: "text", FrameNum: "text", FrameProps: "text", Text: "text",
  LoadPluginAvisynth: "avs",
});

const FILTER_TITLES = Object.freeze({ LoadPluginAvisynth: "LoadPlugin" });

// Metadata drives the inspector and the source serializer. The browser
// authoring API accepts scalar values and homogeneous numeric arrays, so
// every preset stays inside that contract instead of embedding opaque
// Python snippets in the UI.
const FILTER_ARGUMENT_DEFINITIONS = Object.freeze({
  BlankClip: {
    input: "none",
    arguments: [
      { key: "width", label: "Width", kind: "int", defaultValue: 320 },
      { key: "height", label: "Height", kind: "int", defaultValue: 180 },
      { key: "format", label: "Format", kind: "format", defaultValue: "vs.RGB24" },
      { key: "color", label: "Color", kind: "floatArray", defaultValue: "[32.0, 96.0, 224.0]" },
    ],
  },
  AddBorders: {
    arguments: [
      { key: "left", label: "Left", kind: "int", defaultValue: 7 },
      { key: "right", label: "Right", kind: "int", defaultValue: 3 },
      { key: "top", label: "Top", kind: "int", defaultValue: 5 },
      { key: "bottom", label: "Bottom", kind: "int", defaultValue: 9 },
      { key: "color", label: "Color", kind: "floatArray", defaultValue: "[0.0, 0.0, 0.0]" },
    ],
  },
  Crop: {
    arguments: [
      { key: "left", label: "Left", kind: "int", defaultValue: 40 },
      { key: "right", label: "Right", kind: "int", defaultValue: 40 },
      { key: "top", label: "Top", kind: "int", defaultValue: 30 },
      { key: "bottom", label: "Bottom", kind: "int", defaultValue: 30 },
    ],
  },
  Text: { requiresArguments: true },
  Levels: {
    arguments: [
      { key: "min_in", label: "Min in", kind: "floatArray", defaultValue: "[0.0]" },
      { key: "max_in", label: "Max in", kind: "floatArray", defaultValue: "[255.0]" },
      { key: "gamma", label: "Gamma", kind: "floatArray", defaultValue: "[1.0]" },
      { key: "min_out", label: "Min out", kind: "floatArray", defaultValue: "[16.0]" },
      { key: "max_out", label: "Max out", kind: "floatArray", defaultValue: "[235.0]" },
    ],
  },
  Lut: {
    arguments: [{ key: "lut", label: "Lookup table", kind: "intArray", defaultValue: Array.from({ length: 256 }, (_, index) => 255 - index) }],
  },
  ShufflePlanes: {
    arguments: [
      { key: "planes", label: "Planes", kind: "intArray", defaultValue: "[0, 1, 2]" },
      { key: "colorfamily", label: "Color family", kind: "int", defaultValue: 2 },
    ],
  },
  StackHorizontal: { inputExpression: "clip, clip" },
  StackVertical: { inputExpression: "clip, clip" },
  Invert: {},
  FlipHorizontal: {},
  FlipVertical: {},
  Maximum: {},
  Median: {},
  Minimum: {},
  Transpose: {},
  Turn180: {},
});

const NODE_INFO = {
  Output: { namespace: "graph", title: "Program output", summary: "Registers a video node as output 0, which the browser worker renders into the program preview.", signature: "clip.set_output(index=0)", kind: "output" },
};

let canvas;
const source = document.querySelector("textarea");
const run = document.querySelector(".run-button");
const runLabel = document.querySelector("[data-run-label]");
const status = document.querySelector("[data-status-text]");
const runtimeStatus = document.querySelector("[data-runtime-status]");
const graphStatus = document.querySelector("[data-graph-status]");
const graphNodesTarget = document.querySelector("[data-graph-nodes]");
const graphCount = document.querySelector("[data-graph-count]");
const widthControl = document.querySelector("[data-graph-width]");
const heightControl = document.querySelector("[data-graph-height]");
const inspectorTitle = document.querySelector("[data-inspector-title]");
const inspectorPath = document.querySelector("[data-inspector-path]");
const inspectorSpecs = document.querySelector("[data-inspector-specs]");
const inspectorNote = document.querySelector("[data-inspector-note]");
const dimensionControls = document.querySelector("[data-dimension-controls]");
const argumentControls = document.querySelector("[data-argument-controls]");
const argumentRows = document.querySelector("[data-argument-rows]");
const argumentHint = document.querySelector("[data-argument-hint]");
const addArgumentButton = document.querySelector("[data-add-argument]");
const libraryGroups = document.querySelector("[data-library-groups]");
const librarySearch = document.querySelector("[data-library-search]");
const libraryCount = document.querySelector("[data-library-count]");
const addGraphButton = document.querySelector("[data-add-graph]");
const argumentDrafts = new Map();
const diagnostics = createDiagnosticConsole();

let runtimeReady = false;
let rendering = false;
let renderRevision = 0;
let graphState = "ready";
let selectedLibraryFunction = "BlankClip";
let libraryKind = "all";
let selectedIndex = -1;
let rendered = false;
let renderedSource = "";
const nodePositions = new Map();
const dimensions = { width: 320, height: 180 };
let contextMenu = null;
let contextMenuTarget = null;
let contextMenuActions = [];
let wireDrag = null;
let suppressNextNodeClick = false;
let playbackTimer = null;
let playbackSeek = null;
let playbackSeekRunning = false;
let playbackEpoch = 0;
const playback = { outputIndex: 0, frame: 0, numFrames: 1, fpsNum: 0, fpsDen: 1, lastFrameDuration: undefined, playing: false };

window.addEventListener("error", (event) => diagnostics.error("window", event.message || "Unhandled browser error", { filename: event.filename, lineno: event.lineno }));
window.addEventListener("unhandledrejection", (event) => diagnostics.error("promise", event.reason?.message ?? String(event.reason ?? "Unhandled promise rejection")));

const workerUrl = new URL("../runtime/pyodide/bootstrap.mjs", import.meta.url);
const worker = new Worker(workerUrl, { type: "module" });
const client = new PyodideWorkerClient(worker, { onDiagnostic: diagnostics.write });

function setStatus(message, state) { status.textContent = message; runtimeStatus.dataset.state = state; diagnostics.info("status", `${state}: ${message}`); }
function setGraphState(state, message) { graphState = state; graphStatus.dataset.state = state; graphStatus.textContent = message; }
function updateRunControl() { run.disabled = !runtimeReady || rendering; runLabel.textContent = rendering ? "Rendering…" : "Run graph"; run.setAttribute("aria-busy", String(rendering)); }

function filterDefinition(name) {
  const definition = FILTER_ARGUMENT_DEFINITIONS[name];
  return definition ? { ...definition, arguments: definition.arguments ?? [] } : { input: "clip", arguments: [] };
}

function supportsArgumentAuthoring(name) {
  return Object.hasOwn(FILTER_ARGUMENT_DEFINITIONS, name);
}

function formatArgumentDefault(value, kind) {
  if (value === undefined) return "";
  if (Array.isArray(value)) return `[${value.join(", ")}]`;
  if (kind === "string") return String(value);
  return String(value);
}

function getArgumentDraft(name) {
  if (!argumentDrafts.has(name)) {
    const definition = filterDefinition(name);
    argumentDrafts.set(name, definition.arguments.map((argument) => ({
      ...argument,
      value: formatArgumentDefault(argument.defaultValue, argument.kind),
    })));
  }
  return argumentDrafts.get(name);
}

function formatFloatLiteral(value) {
  const text = String(value);
  return Number.isInteger(value) ? `${text}.0` : text;
}

function parseArrayArgument(rawValue, kind, key) {
  const text = rawValue.trim();
  if (!text) throw new Error(`${key} must be a non-empty list`);
  let values;
  try {
    values = JSON.parse(text);
  } catch {
    values = text.split(",").map((value) => value.trim()).filter(Boolean);
  }
  if (!Array.isArray(values) || values.length === 0 || values.length > 4096) {
    throw new Error(`${key} must contain between 1 and 4096 values`);
  }
  const parsed = values.map((value) => {
    const number = Number(value);
    const valid = kind === "intArray"
      ? Number.isSafeInteger(number)
      : Number.isFinite(number);
    if (!valid) throw new Error(`${key} contains an invalid ${kind === "intArray" ? "integer" : "float"}`);
    return kind === "intArray" ? number : formatFloatLiteral(number);
  });
  return `[${parsed.join(", ")}]`;
}

function serializeArgument(argument) {
  const key = argument.key.trim();
  const rawValue = argument.value.trim();
  if (!/^[A-Za-z_]\w*$/.test(key) || PYTHON_KEYWORDS.has(key)) throw new Error("argument names must be Python identifiers and not Python keywords");
  if (!rawValue) throw new Error(`${key} needs a value`);
  switch (argument.kind) {
    case "int": {
      const value = Number(rawValue);
      if (!Number.isSafeInteger(value)) throw new Error(`${key} must be a safe integer`);
      return `${key}=${value}`;
    }
    case "float": {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number`);
      return `${key}=${formatFloatLiteral(value)}`;
    }
    case "format":
      if (!/^vs\.[A-Za-z_]\w*$/.test(rawValue)) throw new Error(`${key} must be a supported vs format`);
      return `${key}=${rawValue}`;
    case "intArray":
    case "floatArray":
      return `${key}=${parseArrayArgument(rawValue, argument.kind, key)}`;
    case "string":
      return `${key}=${JSON.stringify(rawValue)}`;
    default:
      throw new Error(`${key} has an unsupported argument type`);
  }
}

function buildFilterCall(name) {
  if (!supportsArgumentAuthoring(name)) return null;
  const definition = filterDefinition(name);
  const draft = getArgumentDraft(name);
  if (definition.requiresArguments && draft.length === 0) return null;
  const keys = new Set();
  const named = draft.map((argument) => {
    const key = argument.key.trim();
    if (keys.has(key)) throw new Error("argument names must be unique");
    keys.add(key);
    return serializeArgument(argument);
  });
  const positional = definition.input === "none"
    ? []
    : [definition.inputExpression ?? "clip"];
  const argumentsText = [...positional, ...named].join(", ");
  const info = functionInfo(name);
  return `clip = vs.core.${info.namespace}.${info.title}(${argumentsText})`;
}

function createArgumentControl(label, control, className = "") {
  const wrapper = document.createElement("label");
  wrapper.className = `argument-control ${className}`.trim();
  const caption = document.createElement("span");
  caption.textContent = label;
  wrapper.append(caption, control);
  return wrapper;
}

function renderArgumentControls() {
  const info = functionInfo(selectedLibraryFunction);
  const isVideo = info.kind === "video" || info.kind === "source" || info.kind === "filter";
  argumentControls.hidden = !isVideo;
  if (!isVideo) return;
  const definition = filterDefinition(selectedLibraryFunction);
  const draft = getArgumentDraft(selectedLibraryFunction);
  argumentHint.textContent = supportsArgumentAuthoring(selectedLibraryFunction)
    ? definition.requiresArguments && draft.length === 0
      ? "Add the required named arguments before plotting this filter."
      : "Preset values are ready to add. Remove optional rows or add named arguments before plotting."
    : "This function has no safe browser signature metadata and remains a reference draft. Author its exact call in the source editor.";
  argumentRows.replaceChildren();
  getArgumentDraft(selectedLibraryFunction).forEach((argument, index) => {
    const row = document.createElement("div");
    row.className = "argument-row";
    row.dataset.argumentIndex = String(index);
    row.dataset.argumentRow = "";

    const key = document.createElement("input");
    key.type = "text";
    key.value = argument.key;
    key.placeholder = "name";
    key.setAttribute("aria-label", "Argument name");
    key.dataset.argumentKey = "";

    const kind = document.createElement("select");
    kind.setAttribute("aria-label", "Argument type");
    kind.dataset.argumentKind = "";
    for (const option of ["int", "float", "string", "intArray", "floatArray", "format"]) {
      const item = document.createElement("option");
      item.value = option;
      item.textContent = option;
      item.selected = option === argument.kind;
      kind.append(item);
    }

    const value = document.createElement("input");
    value.type = "text";
    value.value = argument.value;
    value.placeholder = argument.kind.endsWith("Array") ? "[0, 1]" : "value";
    value.setAttribute("aria-label", "Argument value");
    value.dataset.argumentValue = "";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "argument-remove";
    remove.textContent = "Remove";
    remove.setAttribute("aria-label", `Remove ${argument.key || "argument"}`);
    remove.dataset.removeArgument = "";

    row.append(
      createArgumentControl("Name", key, "argument-control-key"),
      createArgumentControl("Type", kind, "argument-control-kind"),
      createArgumentControl("Value", value, "argument-control-value"),
      remove,
    );
    argumentRows.append(row);
  });
}

function functionInfo(name) {
  if (NODE_INFO[name]) return NODE_INFO[name];
  const category = CORE_LIBRARY.find((entry) => entry.names.includes(name));
  const namespace = FILTER_NAMESPACES[name] ?? "std";
  const title = FILTER_TITLES[name] ?? name;
  const signature = FILTER_SIGNATURES[name] ?? `${title}(…)`;
  const summary = namespace === "std"
    ? "Documented VapourSynth standard-core function. Reference entries remain subject to the browser runtime boundary."
    : `Documented VapourSynth ${namespace} function. Reference entries remain subject to the browser runtime boundary.`;
  return { namespace, title, summary, signature, kind: category?.kind ?? "video" };
}

function renderLibrary() {
  const query = librarySearch.value.trim().toLowerCase();
  const groups = CORE_LIBRARY.map((entry) => ({ ...entry, names: entry.names.filter((name) => name.toLowerCase().includes(query)) }))
    .filter((entry) => entry.names.length && (libraryKind === "all" || entry.kind === libraryKind));
  const count = groups.reduce((total, entry) => total + entry.names.length, 0);
  libraryCount.textContent = `${count} refs`;
  if (!groups.length) { libraryGroups.innerHTML = '<p class="library-empty">No matching standard-core functions.</p>'; return; }
  libraryGroups.innerHTML = groups.map((entry, index) => `<details class="function-group" ${index < 2 || query ? "open" : ""}><summary>${entry.group}<span>${entry.names.length}</span></summary><div class="function-list">${entry.names.map((name) => {
    const info = functionInfo(name);
    const validated = VECTOR_VALIDATED_FUNCTIONS.has(name);
    const label = info.title === name ? name : `${info.namespace}.${info.title}`;
    return `<button class="function-entry" type="button" draggable="true" data-library-function="${name}" aria-current="${selectedLibraryFunction === name}" aria-label="${label}, ${validated ? "browser render vector" : "documented reference"}. Drag onto the graph to add it.">${label}<span class="function-state ${validated ? "verified" : ""}">${validated ? "vector" : "ref"}</span></button>`;
  }).join("")}</div></details>`).join("");
  libraryGroups.querySelectorAll("[data-library-function]").forEach((button) => button.addEventListener("click", () => selectFunction(button.dataset.libraryFunction, { fromLibrary: true })));
}

function lineOf(charIndex) { return source.value.slice(0, charIndex).split("\n").length - 1; }

function parseScript() {
  const operations = [];
  const callPattern = /^[ \t]*([A-Za-z_]\w*)\s*=\s*vs\.core\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/gm;
  for (const match of source.value.matchAll(callPattern)) operations.push({ id: match[1], namespace: match[2], name: match[3], kind: "filter", line: lineOf(match.index) });
  const referencePattern = /^[ \t]*#\s*Reference:\s*vs\.core\.([A-Za-z_]\w*)\.([A-Za-z_]\w*)\(/gm;
  for (const match of source.value.matchAll(referencePattern)) operations.push({ id: `ref-${operations.length}`, namespace: match[1], name: match[2], kind: "draft", line: lineOf(match.index) });
  const outputs = [...source.value.matchAll(/^[ \t]*([A-Za-z_]\w*)\.set_output\((\d*)\)/gm)];
  if (outputs.length) operations.push({ id: outputs[0][1], namespace: "graph", name: "Output", kind: "output", line: lineOf(outputs[0].index) });
  operations.sort((a, b) => a.line - b.line);
  return operations.length ? operations : [{ id: "graph", namespace: "graph", name: "No plotted calls", kind: "empty", line: 0 }];
}

function splitCallArguments(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === quote) quote = "";
      continue;
    }
    if (character === "\"" || character === "'") { quote = character; continue; }
    if ("([{".includes(character)) depth += 1;
    else if (")]}".includes(character)) depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(text.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(text.slice(start).trim());
  return parts.filter(Boolean);
}

function inferArgumentKind(rawValue) {
  const value = rawValue.trim();
  if (/^["']/.test(value)) return "string";
  if (/^vs\.[A-Za-z_]\w*$/.test(value)) return "format";
  if (value.startsWith("[")) {
    const values = value.slice(1, -1).split(",").map((entry) => entry.trim()).filter(Boolean);
    return values.length && values.every((entry) => Number.isSafeInteger(Number(entry))) ? "intArray" : "floatArray";
  }
  if (Number.isSafeInteger(Number(value))) return "int";
  if (Number.isFinite(Number(value))) return "float";
  return "string";
}

function displayArgumentValue(rawValue, kind) {
  const value = rawValue.trim();
  if (kind === "string" && (value.startsWith("\"") || value.startsWith("'"))) {
    try { return JSON.parse(value); } catch { return value.slice(1, -1); }
  }
  return value;
}

function hydrateArgumentDraft(name, operation) {
  if (!operation || operation.kind !== "filter") return;
  const line = source.value.split("\n")[operation.line] ?? "";
  const start = line.indexOf("(", line.indexOf(`vs.core.${operation.namespace}.${operation.name}`));
  const end = line.lastIndexOf(")");
  if (start < 0 || end <= start) return;
  const definition = filterDefinition(name);
  const positionalCount = definition.input === "none" ? 0 : (definition.inputExpression?.split(",").length ?? 1);
  argumentDrafts.delete(name);
  const draft = getArgumentDraft(name);
  for (const token of splitCallArguments(line.slice(start + 1, end)).slice(positionalCount)) {
    const match = token.match(/^([A-Za-z_]\w*)\s*=\s*(.+)$/);
    if (!match) continue;
    const [, key, rawValue] = match;
    const existing = draft.find((argument) => argument.key === key);
    if (existing) {
      existing.value = displayArgumentValue(rawValue, existing.kind);
    } else {
      const kind = inferArgumentKind(rawValue);
      draft.push({ key, label: key, kind, value: displayArgumentValue(rawValue, kind) });
    }
    if (name === "BlankClip") syncBlankClipDimensionFromArgument(key, displayArgumentValue(rawValue, existing?.kind ?? inferArgumentKind(rawValue)));
  }
}

function renderGraph() {
  const parsed = parseScript();
  graphCount.textContent = String(parsed.length).padStart(2, "0");
  if (parsed[0]?.kind === "empty") { graphNodesTarget.innerHTML = '<p class="node-empty">Drop a library function here, or author a <code>vs.core.namespace.Function(…)</code> call, to plot it. The library remains available while the source record is empty.'; renderMinimap([]); return; }
  const positions = parsed.map((node, index) => nodePositions.get(index) ?? { left: 8 + index * (55 / Math.max(1, parsed.length - 1)), top: node.name === "Output" ? 1 : 29 + (index % 2 ? 22 : 0) });
  const wirePaths = parsed.slice(1).map((node, index) => {
    const start = positions[index]; const end = positions[index + 1];
    const wireClass = [node.kind === "output" ? "is-output" : "", node.kind === "draft" ? "is-draft" : ""].filter(Boolean).join(" ");
    const d = `M ${start.left + 16} ${start.top + 9} C ${start.left + 22} ${start.top + 9}, ${end.left - 6} ${end.top + 9}, ${end.left} ${end.top + 9}`;
    const marker = node.kind === "output" ? "wire-arrow-output" : "wire-arrow";
    const flowClass = node.kind === "output" ? "is-output" : node.kind === "draft" ? "is-draft" : "";
    const flowDur = node.kind === "draft" ? 2.4 : 1.5;
    return `<path class="${wireClass}" data-from="${index}" d="${d}" marker-end="url(#${marker})"/><circle class="wire-flow ${flowClass}" r="1.5"><animateMotion dur="${flowDur}s" repeatCount="indefinite" path="${d}"/></circle>`;
  }).join("");
  const nodes = parsed.map((node, index) => {
    const info = functionInfo(node.name); const active = selectedIndex === index;
    const draftClass = node.kind === "draft" ? " is-draft" : "";
    const body = node.kind === "draft"
      ? `<div class="node-row"><span>input</span><strong>clip</strong></div><div class="node-row"><span>state</span><strong>reference</strong></div>`
      : node.name === "BlankClip" ? `<div class="node-row"><span>width</span><strong>${dimensions.width}</strong></div><div class="node-row"><span>height</span><strong>${dimensions.height}</strong></div><div class="node-row"><span>format</span><strong>RGB24</strong></div>` : `<div class="node-row"><span>input</span><strong>clip</strong></div><div class="node-row"><span>result</span><strong>node</strong></div>`;
    const content = node.name === "Output" ? `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">output 0</span></div><canvas width="320" height="180" aria-label="Rendered VapourSynth frame"></canvas><div class="node-body"><span>worker preview</span><span data-output-state>awaiting render</span></div><div class="playback-controls" data-playback-controls><button class="playback-button" type="button" data-playback-toggle aria-pressed="false" disabled>Play</button><label class="sr-only" for="frame-seek">Frame seek</label><input class="playback-seek" id="frame-seek" type="range" min="0" max="0" value="0" step="1" data-frame-slider disabled aria-describedby="frame-status"><output class="playback-frame-status" id="frame-status" data-frame-status aria-live="polite">Frame 1 / 1</output></div>` : `<div class="graph-node-header"><span class="node-mark"></span>${info.title}<span class="node-namespace">${node.namespace}</span></div><div class="node-body">${body}</div>`;
    const tag = node.name === "Output" ? "div" : "button";
    const nodeAttributes = node.name === "Output" ? 'role="group" aria-pressed="' + active + '"' : 'type="button" aria-pressed="' + active + '"';
    return `<${tag} class="graph-node ${node.name === "Output" ? "program-node" : ""}${draftClass}" ${nodeAttributes} data-graph-node="${node.name}" data-index="${index}" data-kind="${node.kind}" aria-label="${info.title}${node.kind === "draft" ? ", reference draft" : ""}. Drag to move, drag a port to rewire, Delete to remove." style="left:${positions[index].left}%;top:${positions[index].top}%">${index > 0 ? '<span class="node-port in" aria-hidden="true" title="Wire a source here"></span>' : ""}${content}${index < parsed.length - 1 ? '<span class="node-port out" aria-hidden="true" title="Drag to rewire"></span>' : ""}</${tag}>`;
  }).join("");
  graphNodesTarget.innerHTML = `<svg class="graph-wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><marker id="wire-arrow" viewBox="0 0 1 1" refX="0.62" refY="0.5" markerWidth="0.9" markerHeight="0.9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 1 0.5 L 0 1 z" fill="var(--draft)"/></marker><marker id="wire-arrow-output" viewBox="0 0 1 1" refX="0.62" refY="0.5" markerWidth="0.9" markerHeight="0.9" markerUnits="userSpaceOnUse" orient="auto"><path d="M 0 0 L 1 0.5 L 0 1 z" fill="var(--signal)"/></marker></defs>${wirePaths}</svg>${nodes}`;
  graphNodesTarget.querySelectorAll("[data-graph-node]").forEach((node) => {
    const index = Number(node.dataset.index);
    node.addEventListener("click", (event) => {
      if (event.target.closest(".playback-controls")) return;
      if (suppressNextNodeClick) { suppressNextNodeClick = false; return; }
      selectFunction(node.dataset.graphNode, { index });
    });
    attachNodeDrag(node, index);
  });
  renderMinimap(parsed);
  const nextCanvas = graphNodesTarget.querySelector("canvas");
  if (!nextCanvas) return;
  if (canvas && canvas !== nextCanvas) nextCanvas.replaceWith(canvas);
  else canvas = nextCanvas;
  bindPlaybackControls();
}

function attachNodeDrag(nodeEl, index) {
  nodeEl.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".node-port, .playback-controls")) return;
    const panelRect = graphNodesTarget.getBoundingClientRect();
    const nodeRect = nodeEl.getBoundingClientRect();
    const widthPct = (nodeRect.width / panelRect.width) * 100;
    const heightPct = (nodeRect.height / panelRect.height) * 100;
    const startX = event.clientX; const startY = event.clientY;
    const startLeft = ((nodeRect.left - panelRect.left) / panelRect.width) * 100;
    const startTop = ((nodeRect.top - panelRect.top) / panelRect.height) * 100;
    nodeEl.setPointerCapture?.(event.pointerId);
    let moved = false;
    const onMove = (moveEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const left = clamp(startLeft + ((moveEvent.clientX - startX) / panelRect.width) * 100, 0, Math.max(0, 100 - widthPct));
      const top = clamp(startTop + ((moveEvent.clientY - startY) / panelRect.height) * 100, 0, Math.max(0, 100 - heightPct));
      nodeEl.style.left = `${left}%`; nodeEl.style.top = `${top}%`;
      nodeEl.classList.add("is-dragging");
      moved = true;
      updateWiresAround(index);
    };
    const onUp = (upEvent) => {
      if (upEvent.pointerId !== event.pointerId) return;
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      nodeEl.classList.remove("is-dragging");
      if (moved) nodePositions.set(index, { left: parseFloat(nodeEl.style.left), top: parseFloat(nodeEl.style.top) });
    };
    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
  });
}

function updateWiresAround(index) {
  graphNodesTarget.querySelectorAll(".graph-wires path").forEach((path) => {
    const from = Number(path.dataset.from);
    if (from === index - 1 || from === index) path.setAttribute("d", wirePathBetween(from, from + 1));
  });
}

function wirePathBetween(fromIndex, toIndex) {
  const nodes = graphNodesTarget.querySelectorAll("[data-graph-node]");
  const from = nodes[fromIndex]; const to = nodes[toIndex];
  if (!from || !to) return "";
  const startLeft = parseFloat(from.style.left); const startTop = parseFloat(from.style.top);
  const endLeft = parseFloat(to.style.left); const endTop = parseFloat(to.style.top);
  return `M ${startLeft + 16} ${startTop + 9} C ${startLeft + 22} ${startTop + 9}, ${endLeft - 6} ${endTop + 9}, ${endLeft} ${endTop + 9}`;
}

function nudgeNode(index, dx, dy) {
  const node = graphNodesTarget.querySelector(`[data-graph-node][data-index="${index}"]`);
  if (!node) return;
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const widthPct = (nodeRect.width / panelRect.width) * 100;
  const heightPct = (nodeRect.height / panelRect.height) * 100;
  const current = nodePositions.get(index) ?? { left: parseFloat(node.style.left) || 0, top: parseFloat(node.style.top) || 0 };
  const next = { left: clamp(current.left + dx, 0, Math.max(0, 100 - widthPct)), top: clamp(current.top + dy, 0, Math.max(0, 100 - heightPct)) };
  nodePositions.set(index, next);
  node.style.left = `${next.left}%`; node.style.top = `${next.top}%`;
  updateWiresAround(index);
}

function removeNodeAt(index) {
  const parsed = parseScript();
  const op = parsed[index];
  if (!op || op.kind === "output" || op.kind === "empty") return;
  if (op.kind === "draft") removeReferenceLine(op); else removeCallFromSource(op);
  nodePositions.delete(index);
  for (let shifted = index + 1; shifted < parsed.length; shifted += 1) {
    const position = nodePositions.get(shifted);
    if (position) { nodePositions.set(shifted - 1, position); nodePositions.delete(shifted); }
  }
  const nextSelection = parsed[Math.max(0, index - 1)];
  selectFunction(nextSelection?.name ?? "BlankClip", { fromLibrary: nextSelection === undefined });
  touchSource("NODE REMOVED");
}

// Rewires the chain so the op at sourceIndex directly feeds the op at
// targetIndex: the source call block moves to the line just before the
// target's block in the source record. This is the script-logic edit the
// visual ports express: Invert→AddBorders and AddBorders→Invert produce
// different frames, so the source text itself must change.
function moveCallBefore(sourceIndex, targetIndex) {
  const parsed = parseScript();
  const sourceOp = parsed[sourceIndex];
  const targetOp = parsed[targetIndex];
  if (!sourceOp || !targetOp || sourceOp.kind === "output" || targetOp.kind === "empty") return;
  if (sourceIndex === targetIndex) return;
  const lines = source.value.split("\n");
  const start = sourceOp.line;
  const end = blockEndLine(sourceOp, lines);
  const nothingBetween = parsed.every((op) => op === sourceOp || op === targetOp || op.line <= start || op.line >= targetOp.line);
  if (sourceIndex < targetIndex && nothingBetween) return; // already directly feeds the target
  const block = lines.splice(start, end - start);
  let targetLine = targetOp.line;
  if (targetOp.line > start) targetLine -= end - start;
  lines.splice(targetLine, 0, ...block);
  source.value = lines.join("\n");
  shiftPositionsAfterMove(sourceIndex, targetIndex);
  const reparse = parseScript();
  const movedIndex = reparse.findIndex((op) => op.line === targetLine && op.kind === sourceOp.kind && op.name === sourceOp.name);
  selectFunction(sourceOp.name, { index: movedIndex !== -1 ? movedIndex : targetIndex });
  touchSource("NODE REWIRED");
}

function blockEndLine(op, lines) {
  const pattern = new RegExp(`^\\s*${escapeRegExp(op.id)}\\s*=\\s*vs\\.core\\.`);
  if (!pattern.test(lines[op.line] ?? "")) return op.line + 1;
  let depth = 0; let end = op.line;
  do { for (const character of lines[end] ?? "") { if (character === "(") depth += 1; else if (character === ")") depth -= 1; } end += 1; } while (depth > 0 && end < lines.length);
  return end;
}

function shiftPositionsAfterMove(sourceIndex, targetIndex) {
  const next = new Map();
  for (const [key, value] of nodePositions) {
    if (sourceIndex < targetIndex) {
      if (key === sourceIndex) next.set(targetIndex - 1, value);
      else if (key > sourceIndex && key < targetIndex) next.set(key - 1, value);
      else next.set(key, value);
    } else {
      if (key === sourceIndex) next.set(targetIndex, value);
      else if (key >= targetIndex && key < sourceIndex) next.set(key + 1, value);
      else next.set(key, value);
    }
  }
  nodePositions.clear();
  for (const [key, value] of next) nodePositions.set(key, value);
}

function removeCallFromSource(op) {
  const lines = source.value.split("\n");
  const pattern = new RegExp(`^\\s*${escapeRegExp(op.id)}\\s*=\\s*vs\\.core\\.`);
  if (!pattern.test(lines[op.line] ?? "")) return;
  lines.splice(op.line, blockEndLine(op, lines) - op.line);
  source.value = lines.join("\n");
}

function removeReferenceLine(op) {
  const lines = source.value.split("\n");
  const pattern = new RegExp(`^\\s*#\\s*Reference:\\s*vs\\.core\\.${escapeRegExp(op.namespace)}\\.${escapeRegExp(op.name)}\\(`);
  if (!pattern.test(lines[op.line] ?? "")) return;
  lines.splice(op.line, 1);
  source.value = lines.join("\n");
}

function addNodeToGraph(name) {
  const info = functionInfo(name);
  const isVideo = info.kind === "video" || info.kind === "source" || info.kind === "filter";
  if (!isVideo) return { added: false, error: "Only video functions can plot on the video route" };
  let call;
  try {
    call = buildFilterCall(name);
  } catch (error) {
    return { added: false, error: error.message };
  }
  if (call) insertSourceLine(call, null);
  else insertSourceLine(null, `# Reference: vs.core.${info.namespace}.${info.title}(…)`);
  return { added: true, executable: Boolean(call), call };
}

function insertSourceLine(call, referenceNote) {
  const block = referenceNote ? `${referenceNote}\n${call ?? ""}`.trimEnd() : call;
  const outputMatch = source.value.match(/^\s*[A-Za-z_]\w*\s*\.set_output\(/m);
  source.value = outputMatch
    ? `${source.value.slice(0, outputMatch.index)}${block}\n${source.value.slice(outputMatch.index)}`
    : `${source.value.trimEnd()}\n${block}\n`;
  touchSource("NODE ADDED");
}

function renderMinimap(parsed) {
  const svg = document.querySelector(".minimap svg");
  if (!svg) return;
  const count = Math.min(parsed.length, 4);
  const rects = []; const points = [];
  for (let index = 0; index < count; index += 1) {
    const x = 10 + index * 26; const y = 24 + (index % 2 ? 9 : 0);
    rects.push(`<rect x="${x}" y="${y}" width="20" height="13"/>`);
    points.push(`${x + 10},${y + 6}`);
  }
  const route = count > 1 ? `<path d="M ${points.join(" L ")}"/>` : "";
  svg.innerHTML = `<rect x="2" y="2" width="116" height="66"/>${rects.join("")}${route}`;
}
function renderInspectorSpecs(rows) {
  const fragment = document.createDocumentFragment();
  for (const [label, value] of rows) {
    const term = document.createElement("dt");
    term.textContent = label;
    const description = document.createElement("dd");
    description.textContent = value;
    fragment.append(term, description);
  }
  inspectorSpecs.replaceChildren(fragment);
}


function selectFunction(name, { fromLibrary = false, index } = {}) {
  const info = functionInfo(name);
  if (fromLibrary || index !== undefined) selectedLibraryFunction = name;
  if (index !== undefined) selectedIndex = index;
  else if (fromLibrary) {
    const parsed = parseScript();
    selectedIndex = parsed.findLastIndex((op) => op.name === name && op.kind !== "output");
  } else selectedIndex = -1;
  const selectedOperation = selectedIndex >= 0 ? parseScript()[selectedIndex] : undefined;
  hydrateArgumentDraft(name, selectedOperation);
  const isVideo = info.kind === "video" || info.kind === "source" || info.kind === "filter";
  const argumentCount = isVideo ? getArgumentDraft(name).length : 0;
  inspectorTitle.textContent = info.title;
  inspectorPath.textContent = info.namespace === "graph" ? info.signature : `vs.core.${info.namespace}.${info.title}`;
  const validated = VECTOR_VALIDATED_FUNCTIONS.has(name);
  renderInspectorSpecs([
    ["Call", info.signature],
    ["Role", info.kind],
    ["Arguments", `${argumentCount} configured`],
    ["Validation", validated ? "browser render vector" : "upstream on run"],
    ["Graph", fromLibrary ? "library selection" : "plotted operation"],
  ]);
  inspectorNote.textContent = validated
    ? info.summary
    : `${info.summary} Configure arguments below before adding it to the graph.`;
  dimensionControls.hidden = name !== "BlankClip";
  updateAddGraphControl();
  renderArgumentControls();
  renderGraph();
  if (fromLibrary || index !== undefined) renderLibrary();
}

function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function selectedBlankClipLine() {
  const parsed = parseScript();
  const selected = selectedIndex >= 0 ? parsed[selectedIndex] : undefined;
  if (selected?.name === "BlankClip") return selected.line;
  return parsed.find((operation) => operation.name === "BlankClip")?.line ?? -1;
}
function updateBlankClipDimensions() {
  const lines = source.value.split("\n");
  const lineIndex = selectedBlankClipLine();
  if (lineIndex < 0) return false;
  const pattern = /^(\s*[A-Za-z_]\w*\s*=\s*vs\.core\.std\.BlankClip\(width=)\d+([^)]*height=)\d+([^)]*\))$/;
  const match = lines[lineIndex]?.match(pattern);
  if (!match) return false;
  const replacement = `${match[1]}${dimensions.width}${match[2]}${dimensions.height}${match[3]}`;
  if (lines[lineIndex] === replacement) return false;
  lines[lineIndex] = replacement;
  source.value = lines.join("\n");
  return true;
}
function clampDimension(control, fallback) { const value = Number.parseInt(control.value, 10); const min = Number.parseInt(control.min, 10); const max = Number.parseInt(control.max, 10); return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : fallback; }
function markChanged(message = "CHANGED") { setGraphState("changed", message); }
function touchSource(message) { markChanged(message); renderGraph(); clearStalePreview(); }
function clearStalePreview() {
  if (renderedSource === source.value && rendered) return;
  cancelPlayback();
  renderRevision += 1;
  rendered = false;
  playback.frame = 0;
  playback.numFrames = 1;
  if (canvas) canvas.getContext("2d").clearRect(0, 0, canvas.width, canvas.height);
  document.querySelectorAll("[data-output-state]").forEach((target) => { target.textContent = "awaiting render"; target.dataset.state = "changed"; });
  updatePlaybackControls();
}
function cancelPlayback() {
  renderRevision += 1;
  playbackEpoch += 1;
  playback.playing = false;
  playbackSeek = null;
  if (playbackTimer !== null) { clearTimeout(playbackTimer); playbackTimer = null; }
  updatePlaybackControls();
}
function configurePlayback(output) {
  playback.outputIndex = output.index;
  playback.frame = 0;
  playback.numFrames = Math.max(1, Number.isSafeInteger(output.numFrames) ? output.numFrames : 1);
  playback.fpsNum = Number.isFinite(output.fpsNum) ? output.fpsNum : 0;
  playback.fpsDen = Number.isFinite(output.fpsDen) && output.fpsDen > 0 ? output.fpsDen : 1;
  playback.lastFrameDuration = undefined;
}
function frameStatus() { return `Frame ${playback.frame + 1} / ${playback.numFrames}`; }
function updatePlaybackControls() {
  const enabled = rendered && playback.numFrames > 1;
  document.querySelectorAll("[data-playback-toggle]").forEach((button) => {
    button.disabled = !enabled;
    button.textContent = playback.playing ? "Pause" : "Play";
    button.setAttribute("aria-pressed", String(playback.playing));
  });
  document.querySelectorAll("[data-frame-slider]").forEach((slider) => {
    slider.max = String(Math.max(0, playback.numFrames - 1));
    slider.value = String(playback.frame);
    slider.disabled = !enabled;
  });
  document.querySelectorAll("[data-frame-status]").forEach((target) => { target.textContent = frameStatus(); });
}
function reportPlaybackError(error, revision, epoch = playbackEpoch) {
  if (revision !== renderRevision || epoch !== playbackEpoch) return;
  cancelPlayback();
  const message = `${error?.code ?? "error"}: ${error?.message ?? String(error)}`;
  diagnostics.error("playback", message, error?.stack);
  setStatus(message, "error");
  setGraphState("error", "PLAYBACK FAILED");
}
function queuePlaybackSeek(frame, revision) {
  playbackSeek = { frame, revision, epoch: playbackEpoch };
  if (playbackSeekRunning) return;
  playbackSeekRunning = true;
  void (async () => {
    try {
      while (playbackSeek) {
        const request = playbackSeek;
        playbackSeek = null;
        try {
          await renderPlaybackFrame(request.frame, request.revision, request.epoch);
        } catch (error) {
          reportPlaybackError(error, request.revision, request.epoch);
        }
      }
    } finally {
      playbackSeekRunning = false;
      if (playbackSeek) queuePlaybackSeek(playbackSeek.frame, playbackSeek.revision);
    }
  })();
}
function bindPlaybackControls() {
  updatePlaybackControls();
  document.querySelectorAll("[data-playback-toggle]").forEach((button) => button.addEventListener("click", () => {
    if (playback.playing) cancelPlayback(); else startPlayback();
  }));
  document.querySelectorAll("[data-frame-slider]").forEach((slider) => slider.addEventListener("input", () => {
    const frame = Number(slider.value);
    cancelPlayback();
    queuePlaybackSeek(frame, renderRevision);
  }));
}
async function renderPlaybackFrame(frameNumber, revision, epoch = playbackEpoch) {
  const frame = clamp(Math.trunc(frameNumber), 0, playback.numFrames - 1);
  const renderedFrame = await client.renderOutput(playback.outputIndex, frame);
  if (revision !== renderRevision || epoch !== playbackEpoch || !rendered || renderedSource !== source.value) return false;
  drawRgbaFrame(canvas, renderedFrame);
  playback.frame = frame;
  playback.lastFrameDuration = renderedFrame.duration;
  setStatus(`Rendered ${renderedFrame.width}×${renderedFrame.height} RGBA8 · ${frameStatus()}`, "ready");
  setGraphState("ready", `RENDERED ${renderedFrame.width}×${renderedFrame.height}`);
  document.querySelectorAll("[data-output-state]").forEach((target) => { target.textContent = `${renderedFrame.width}×${renderedFrame.height}`; target.dataset.state = "ready"; });
  updatePlaybackControls();
  return renderedFrame;
}
function startPlayback() {
  if (!rendered || playback.numFrames < 2) return;
  playbackEpoch += 1;
  playbackSeek = null;
  playback.playing = true;
  const epoch = playbackEpoch;
  const revision = renderRevision;
  const defaultFrameDelay = Math.max(1, Math.round(1000 / (playback.fpsNum > 0 ? playback.fpsNum / playback.fpsDen : 24)));
  const scheduleNext = (frame) => {
    if (!playback.playing || revision !== renderRevision || epoch !== playbackEpoch) return;
    const duration = Number(frame?.duration ?? playback.lastFrameDuration);
    const frameDelay = Number.isSafeInteger(duration) && duration >= 0
      ? Math.max(1, Math.round(duration / 1000))
      : defaultFrameDelay;
    playbackTimer = setTimeout(advance, frameDelay);
  };
  const advance = async () => {
    playbackTimer = null;
    if (!playback.playing || revision !== renderRevision || epoch !== playbackEpoch) return;
    const next = playback.frame + 1;
    if (next >= playback.numFrames) {
      playback.playing = false;
      updatePlaybackControls();
      return;
    }
    try {
      const frame = await renderPlaybackFrame(next, revision, epoch);
      if (frame) scheduleNext(frame);
    } catch (error) {
      reportPlaybackError(error, revision, epoch);
    }
  };
  updatePlaybackControls();
  if (playback.frame >= playback.numFrames - 1) {
    void (async () => {
      try {
        const frame = await renderPlaybackFrame(0, revision, epoch);
        if (frame) scheduleNext(frame);
      } catch (error) {
        reportPlaybackError(error, revision, epoch);
      }
    })();
  } else {
    scheduleNext();
  }
}
function updateAddGraphControl() {
  if (!addGraphButton) return;
  const info = functionInfo(selectedLibraryFunction);
  const isVideo = info.kind === "video" || info.kind === "source" || info.kind === "filter";
  addGraphButton.disabled = !isVideo;
  addGraphButton.title = !isVideo ? "Only video functions can plot on the video route" : "";
}

function formatThreadingStatus(threading) {
  if (!threading || typeof threading !== "object") return "scheduler status unavailable";
  if (!threading.available || threading.active === "unavailable") {
    return `${threading.compiled ?? "threaded"} unavailable · ${threading.reason ?? "browser prerequisites missing"}`;
  }
  const fallback = threading.fallback ? " · single-thread fallback" : "";
  return `${threading.active ?? "single-thread"} active${fallback}`;
}

async function refreshStatus() {
  setStatus("Starting browser workers…", "loading");
  const capabilities = await client.status();
  runtimeReady = capabilities.upstreamLinked && capabilities.threading?.available !== false;
  const capsTarget = document.querySelector("[data-authoring-caps]");
  if (capsTarget) capsTarget.textContent = runtimeReady && capabilities.authoring?.available ? `plan version ${capabilities.authoring.planVersion} · source format ${capabilities.authoring.format}` : "authoring unavailable";
  const threadingTarget = document.querySelector("[data-threading-status]");
  if (threadingTarget) threadingTarget.textContent = formatThreadingStatus(capabilities.threading);
  if (runtimeReady) setStatus("Runtime ready · author or run a graph", "ready"); else setStatus("Pyodide ready · Emscripten runtime not attached", "idle");
  updateRunControl();
}

async function renderScript() {
  if (!runtimeReady || rendering) return;
  cancelPlayback();
  const revision = renderRevision;
  const scriptAtStart = source.value;
  rendering = true; setStatus("Executing editor.vpy…", "rendering"); setGraphState("rendering", "RENDERING"); updateRunControl();
  try {
    const { outputs } = await client.runScript(scriptAtStart, "editor.vpy");
    if (revision !== renderRevision || scriptAtStart !== source.value) return;
    const output = outputs.find(({ index }) => index === 0);
    if (!output) throw new Error("the script did not register output 0 with clip.set_output()");
    configurePlayback(output);
    rendered = true; renderedSource = scriptAtStart;
    if (!await renderPlaybackFrame(0, revision)) return;
  } catch (error) {
    if (revision !== renderRevision || scriptAtStart !== source.value) return;
    const message = `${error.code ?? "error"}: ${error.message}`;
    diagnostics.error("render", message, error.stack);
    rendered = false; renderedSource = ""; clearStalePreview();
    setStatus(message, "error");
    setGraphState("error", "RENDER FAILED");
  } finally { rendering = false; updateRunControl(); }
}

function syncBlankClipArgument(key, value) {
  const argument = getArgumentDraft("BlankClip").find((entry) => entry.key === key);
  if (argument) argument.value = String(value);
}

function syncBlankClipDimensionFromArgument(key, value) {
  if (key !== "width" && key !== "height") return;
  const control = key === "width" ? widthControl : heightControl;
  const numeric = Number(value);
  if (!Number.isSafeInteger(numeric)) return;
  const min = Number.parseInt(control.min, 10);
  const max = Number.parseInt(control.max, 10);
  dimensions[key] = clamp(numeric, min, max);
  control.value = String(dimensions[key]);
  if (updateBlankClipDimensions()) touchSource("DIMENSIONS CHANGED");
  else renderGraph();
}

run.addEventListener("click", renderScript);
source.addEventListener("input", () => { markChanged("SOURCE CHANGED"); renderGraph(); clearStalePreview(); });
source.addEventListener("keydown", (event) => { if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) { event.preventDefault(); void renderScript(); } });
widthControl.addEventListener("input", () => { dimensions.width = clampDimension(widthControl, dimensions.width); syncBlankClipArgument("width", dimensions.width); if (updateBlankClipDimensions()) touchSource("DIMENSIONS CHANGED"); selectFunction("BlankClip", { fromLibrary: true }); });
heightControl.addEventListener("input", () => { dimensions.height = clampDimension(heightControl, dimensions.height); syncBlankClipArgument("height", dimensions.height); if (updateBlankClipDimensions()) touchSource("DIMENSIONS CHANGED"); selectFunction("BlankClip", { fromLibrary: true }); });
librarySearch.addEventListener("input", renderLibrary);
document.querySelectorAll(".library-tab").forEach((tab) => tab.addEventListener("click", () => { libraryKind = tab.textContent.toLowerCase(); document.querySelectorAll(".library-tab").forEach((candidate) => candidate.setAttribute("aria-selected", String(candidate === tab))); renderLibrary(); }));
document.querySelector("[data-copy-call]").addEventListener("click", () => copySignature(functionInfo(selectedLibraryFunction).signature));
document.querySelector("[data-insert-note]").addEventListener("click", () => {
  const info = functionInfo(selectedLibraryFunction);
  const signature = info.namespace === "graph" ? info.signature : `vs.core.${info.namespace}.${info.title}(…)`;
  insertSourceLine(null, `# Reference: ${signature}`);
  inspectorNote.textContent = "A reference note was inserted into the source record.";
});
document.querySelector("[data-add-graph]").addEventListener("click", () => {
  const name = selectedLibraryFunction;
  const result = addNodeToGraph(name);
  if (!result.added) {
    inspectorNote.textContent = result.error;
    setGraphState("error", "ARGUMENTS INVALID");
    return;
  }
  selectFunction(name, { fromLibrary: true });
  inspectorNote.textContent = result.executable
    ? "The configured call was appended before set_output(). Run the graph to validate it against the upstream core."
    : "A reference draft was plotted. Add named arguments, then add it again to generate a runnable call.";
});
addArgumentButton.addEventListener("click", () => {
  const draft = getArgumentDraft(selectedLibraryFunction);
  draft.push({ key: `argument${draft.length + 1}`, label: "Argument", kind: "string", value: "" });
  renderArgumentControls();
  argumentRows.querySelector("[data-argument-key]:last-of-type")?.focus();
});
argumentRows.addEventListener("input", (event) => {
  const row = event.target.closest("[data-argument-row]");
  if (!row) return;
  const argument = getArgumentDraft(selectedLibraryFunction)[Number(row.dataset.argumentIndex)];
  if (!argument) return;
  if (event.target.matches("[data-argument-key]")) {
    argument.key = event.target.value;
    if (selectedLibraryFunction === "BlankClip") syncBlankClipDimensionFromArgument(argument.key, argument.value);
  }
  if (event.target.matches("[data-argument-value]")) {
    argument.value = event.target.value;
    if (selectedLibraryFunction === "BlankClip") syncBlankClipDimensionFromArgument(argument.key, argument.value);
  }
});
argumentRows.addEventListener("change", (event) => {
  const row = event.target.closest("[data-argument-row]");
  if (!row) return;
  const argument = getArgumentDraft(selectedLibraryFunction)[Number(row.dataset.argumentIndex)];
  if (!argument) return;
  if (event.target.matches("[data-argument-kind]")) {
    argument.kind = event.target.value;
    argument.value = "";
    renderArgumentControls();
  }
});
argumentRows.addEventListener("click", (event) => {
  const remove = event.target.closest("[data-remove-argument]");
  if (!remove) return;
  const row = remove.closest("[data-argument-row]");
  getArgumentDraft(selectedLibraryFunction).splice(Number(row.dataset.argumentIndex), 1);
  renderArgumentControls();
});
document.querySelector(".theme-toggle").addEventListener("click", (event) => {
  const highContrast = event.currentTarget.getAttribute("aria-pressed") !== "true";
  event.currentTarget.setAttribute("aria-pressed", String(highContrast));
  event.currentTarget.textContent = highContrast ? "Drafting contrast" : "Dark draft";
  if (highContrast) document.documentElement.setAttribute("data-contrast", "high");
  else document.documentElement.removeAttribute("data-contrast");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", highContrast ? "#0e0d0b" : "#171512");
});
libraryGroups.addEventListener("dragstart", (event) => {
  const button = event.target.closest("[data-library-function]");
  if (!button) return;
  event.dataTransfer.setData("text/plain", button.dataset.libraryFunction);
  event.dataTransfer.effectAllowed = "copy";
});
graphNodesTarget.addEventListener("dragover", (event) => { if (event.dataTransfer.types.includes("text/plain")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; graphNodesTarget.classList.add("is-drop-target"); } });
graphNodesTarget.addEventListener("dragleave", () => graphNodesTarget.classList.remove("is-drop-target"));
graphNodesTarget.addEventListener("drop", (event) => {
  event.preventDefault();
  graphNodesTarget.classList.remove("is-drop-target");
  const name = event.dataTransfer.getData("text/plain");
  if (!name) return;
  selectFunction(name, { fromLibrary: true });
  const result = addNodeToGraph(name);
  if (!result.added) inspectorNote.textContent = result.error;
});
graphNodesTarget.addEventListener("keydown", (event) => {
  const node = event.target.closest("[data-graph-node]");
  if (!node) return;
  const index = Number(node.dataset.index);
  if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); removeNodeAt(index); }
  else if (event.key.startsWith("Arrow")) {
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
    const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
    nudgeNode(index, dx, dy);
  }
});
graphNodesTarget.addEventListener("contextmenu", (event) => {
  const node = event.target.closest("[data-graph-node]");
  if (!node) return;
  event.preventDefault();
  const index = Number(node.dataset.index);
  selectFunction(node.dataset.graphNode, { index });
  const anchor = event.clientX === 0 && event.clientY === 0 ? (() => { const rect = node.getBoundingClientRect(); return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }; })() : { x: event.clientX, y: event.clientY };
  openContextMenu(node, anchor.x, anchor.y);
});

async function copySignature(signature) {
  try { await navigator.clipboard.writeText(signature); inspectorNote.textContent = "Function call copied to the clipboard."; }
  catch { inspectorNote.textContent = `Copy this call: ${signature}`; }
}

function ensureContextMenu() {
  if (contextMenu) return contextMenu;
  contextMenu = document.createElement("div");
  contextMenu.className = "context-menu";
  contextMenu.setAttribute("role", "menu");
  contextMenu.setAttribute("aria-label", "Node actions");
  contextMenu.hidden = true;
  contextMenu.addEventListener("click", (event) => {
    const item = event.target.closest("[data-item]");
    if (!item || item.disabled) return;
    const action = contextMenuActions[Number(item.dataset.item)];
    closeContextMenu();
    action?.();
  });
  contextMenu.addEventListener("keydown", (event) => {
    const items = [...contextMenu.querySelectorAll("[data-item]:not(:disabled)")];
    const current = items.indexOf(document.activeElement);
    if (event.key === "Escape") { event.preventDefault(); closeContextMenu(); }
    else if (event.key === "ArrowDown") { event.preventDefault(); items[(current + 1) % items.length]?.focus(); }
    else if (event.key === "ArrowUp") { event.preventDefault(); items[(current - 1 + items.length) % items.length]?.focus(); }
    else if (event.key === "Home") { event.preventDefault(); items[0]?.focus(); }
    else if (event.key === "End") { event.preventDefault(); items[items.length - 1]?.focus(); }
  });
  document.body.append(contextMenu);
  return contextMenu;
}

function openContextMenu(node, x, y) {
  const menu = ensureContextMenu();
  closeContextMenu({ restoreFocus: false });
  const kind = node.dataset.kind;
  const info = functionInfo(node.dataset.graphNode);
  contextMenuTarget = node;
  const items = [];
  if (kind === "output") items.push({ label: "Delete node", hint: "Del", disabled: true, title: "The program output is not deletable" });
  else items.push({ label: "Delete node", hint: "Del", action: () => removeNodeAt(Number(node.dataset.index)) });
  items.push({ label: "Copy call", action: () => copySignature(info.signature) });
  contextMenuActions = items.map((item) => item.action);
  menu.innerHTML = items.map((item, itemIndex) => `<button type="button" class="context-menu-item" role="menuitem" data-item="${itemIndex}" ${item.disabled ? "disabled" : ""} ${item.title ? `title="${item.title}"` : ""}><span>${item.label}</span>${item.hint ? `<kbd>${item.hint}</kbd>` : ""}</button>`).join("");
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const margin = 8;
  menu.style.left = `${clamp(x, margin, window.innerWidth - rect.width - margin)}px`;
  menu.style.top = `${clamp(y, margin, window.innerHeight - rect.height - margin)}px`;
  menu.querySelector("[data-item]:not(:disabled)")?.focus({ preventScroll: true });
}

function closeContextMenu({ restoreFocus = true } = {}) {
  if (!contextMenu || contextMenu.hidden) { contextMenuTarget = null; return; }
  const target = contextMenuTarget;
  contextMenu.hidden = true;
  contextMenu.innerHTML = "";
  contextMenuActions = [];
  contextMenuTarget = null;
  if (restoreFocus && target) target.focus({ preventScroll: true });
}

document.addEventListener("pointerdown", (event) => {
  if (contextMenu && !contextMenu.hidden && !contextMenu.contains(event.target)) closeContextMenu();
});
window.addEventListener("blur", () => closeContextMenu());
window.addEventListener("resize", () => closeContextMenu({ restoreFocus: false }));
window.addEventListener("scroll", () => closeContextMenu({ restoreFocus: false }), true);

// Wire ports: drag an out-port onto another node (or the empty canvas to
// append) to rewire the script chain; an in-port dragged onto a node makes
// that node feed it. Ports mirror the linear clip pipeline, so a wire A→B
// means A's call block moves to the line directly before B's.
graphNodesTarget.addEventListener("pointerdown", (event) => {
  if (event.button !== 0) return;
  const port = event.target.closest(".node-port");
  if (!port) return;
  event.preventDefault();
  const node = port.closest("[data-graph-node]");
  const index = Number(node.dataset.index);
  const kind = port.classList.contains("in") ? "in" : "out";
  startWireDrag(port, index, kind);
  const onMove = (moveEvent) => updateRubberWire(moveEvent.clientX, moveEvent.clientY);
  const onUp = (upEvent) => { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("keydown", onKey); endWireDrag(upEvent); };
  const onKey = (keyEvent) => { if (keyEvent.key === "Escape") { document.removeEventListener("pointermove", onMove); document.removeEventListener("pointerup", onUp); document.removeEventListener("keydown", onKey); cancelWireDrag(); } };
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("keydown", onKey);
});

function startWireDrag(portEl, index, kind) {
  const wiresSvg = graphNodesTarget.querySelector(".graph-wires");
  const start = wirePortCenter(portEl);
  const rubber = document.createElementNS("http://www.w3.org/2000/svg", "path");
  rubber.setAttribute("class", "wire-rubber");
  rubber.setAttribute("d", rubberPath(start, start));
  wiresSvg.append(rubber);
  wireDrag = { index, kind, start, rubber };
  graphNodesTarget.classList.add("is-connecting");
}

function wirePortCenter(portEl) {
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const portRect = portEl.getBoundingClientRect();
  return { x: ((portRect.left + portRect.width / 2 - panelRect.left) / panelRect.width) * 100, y: ((portRect.top + portRect.height / 2 - panelRect.top) / panelRect.height) * 100 };
}

function rubberPath(from, to) {
  return `M ${from.x} ${from.y} C ${from.x + 4} ${from.y}, ${to.x - 4} ${to.y}, ${to.x} ${to.y}`;
}

function updateRubberWire(clientX, clientY) {
  if (!wireDrag) return;
  const panelRect = graphNodesTarget.getBoundingClientRect();
  const to = { x: ((clientX - panelRect.left) / panelRect.width) * 100, y: ((clientY - panelRect.top) / panelRect.height) * 100 };
  wireDrag.rubber.setAttribute("d", rubberPath(wireDrag.start, to));
  const target = document.elementFromPoint(clientX, clientY)?.closest("[data-graph-node]");
  graphNodesTarget.querySelectorAll(".graph-node.is-connect-target").forEach((node) => node.classList.remove("is-connect-target"));
  if (target) target.classList.add("is-connect-target");
}

function endWireDrag(event) {
  if (!wireDrag) return;
  const { index, kind } = wireDrag;
  cancelWireDrag();
  suppressNextNodeClick = true;
  const parsed = parseScript();
  const targetEl = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-graph-node]");
  const targetIndex = targetEl ? Number(targetEl.dataset.index) : -1;
  const outputIndex = parsed.findIndex((op) => op.kind === "output");
  if (targetIndex === index) return;
  if (kind === "out") {
    // The dragged node's output feeds the drop target; dropping on the
    // canvas appends it as the final stage.
    const sourceOp = parsed[index];
    if (!sourceOp || sourceOp.kind === "output") return;
    if (targetIndex === 0) moveCallBefore(index, 1);
    else if (targetIndex > 0) moveCallBefore(index, targetIndex);
    else if (outputIndex !== -1) moveCallBefore(index, outputIndex);
  } else if (targetIndex > 0) {
    // The drop target feeds the dragged node's input. The Output node
    // has no output to give, so it cannot feed anything.
    const feeder = parsed[targetIndex];
    if (feeder && feeder.kind !== "output") moveCallBefore(targetIndex, index);
  } else if (targetIndex === 0) {
    // Wire to the BlankClip slot: the dragged node becomes the first stage.
    moveCallBefore(index, 1);
  }
}

function cancelWireDrag() {
  if (!wireDrag) return;
  wireDrag.rubber.remove();
  wireDrag = null;
  graphNodesTarget.classList.remove("is-connecting");
  graphNodesTarget.querySelectorAll(".graph-node.is-connect-target").forEach((node) => node.classList.remove("is-connect-target"));
}

graphNodesTarget.addEventListener("mouseover", (event) => {
  const port = event.target.closest(".node-port");
  if (!port) return;
  const node = port.closest("[data-graph-node]");
  const from = port.classList.contains("out") ? Number(node.dataset.index) : Number(node.dataset.index) - 1;
  graphNodesTarget.querySelectorAll(`.graph-wires path[data-from="${from}"]`).forEach((path) => path.classList.add("is-hovered"));
});
graphNodesTarget.addEventListener("mouseout", (event) => {
  const port = event.target.closest(".node-port");
  if (!port) return;
  const node = port.closest("[data-graph-node]");
  const from = port.classList.contains("out") ? Number(node.dataset.index) : Number(node.dataset.index) - 1;
  graphNodesTarget.querySelectorAll(`.graph-wires path[data-from="${from}"]`).forEach((path) => path.classList.remove("is-hovered"));
});

renderLibrary(); selectFunction("BlankClip", { fromLibrary: true });
window.addEventListener("pagehide", () => { cancelPlayback(); client.close(); }, { once: true });
refreshStatus().catch((error) => { runtimeReady = false; diagnostics.error("startup", error.message, error.stack); setStatus(`startup-error: ${error.message}`, "error"); updateRunControl(); });

function createDiagnosticConsole() {
  const details = document.querySelector("details.diagnostics"); const log = details?.querySelector(".diagnostics-log"); const clearButton = details?.querySelector(".diagnostics-clear");
  clearButton?.addEventListener("click", () => { log.textContent = ""; });
  const write = ({ level = "info", source = "client", message, detail, timestamp = new Date().toISOString() }) => { if (!log) return; const line = document.createElement("span"); line.className = `diagnostic-${level}`; let text = `[${timestamp.slice(11, 23)}] ${level.toUpperCase().padEnd(5)} ${source}: ${message}`; if (detail) text += `\n  ${typeof detail === "string" ? detail : JSON.stringify(detail)}`; line.textContent = `${text}\n`; log.append(line); log.scrollTop = log.scrollHeight; if (level === "error") details.open = true; };
  return { write, info: (source, message, detail) => write({ level: "info", source, message, detail }), warn: (source, message, detail) => write({ level: "warn", source, message, detail }), error: (source, message, detail) => write({ level: "error", source, message, detail }) };
}
