import assert from "node:assert/strict";
import test from "node:test";

import { PyodideWorkerClient } from "./pyodide-worker-client.mjs";
import { installPyodideWorkerRuntime, startPyodideWorkerRuntime } from "./pyodide-worker-runtime.mjs";

function session() {
  return {
    async status() {
      return { schemaVersion: 1, pyodide: { initialized: true } };
    },
    async runScript(source, filename) {
      return {
        outputs: [{ index: 0, width: source.length, height: filename.length, format: "RGB24", length: 1 }],
      };
    },
    async renderOutput(index, frame) {
      return {
        width: index + 1,
        height: frame + 1,
        rgba: new Uint8Array((index + 1) * (frame + 1) * 4).fill(255),
      };
    },
  };
}

function linkedWorker() {
  let onmessage;
  const main = {
    get onmessage() {
      return onmessage;
    },
    set onmessage(handler) {
      onmessage = handler;
      queueMicrotask(() => handler({ data: { schemaVersion: 1, type: "ready" } }));
    },
  };
  const workerScope = {
    postMessage(data) {
      queueMicrotask(() => main.onmessage?.({ data }));
    },
  };
  main.postMessage = (data) => queueMicrotask(() => workerScope.onmessage?.({ data }));
  main.terminate = () => {};
  installPyodideWorkerRuntime(workerScope, session());
  return main;
}

test("correlates Python script and frame requests through the outer worker", async () => {
  const client = new PyodideWorkerClient(linkedWorker());
  const [status, outputs, frame] = await Promise.all([
    client.status(),
    client.runScript("x = 1", "author.vpy"),
    client.renderOutput(1, 2),
  ]);

  assert.equal(status.pyodide.initialized, true);
  assert.deepEqual(outputs.outputs, [{ index: 0, width: 5, height: 10, format: "RGB24", length: 1 }]);
  assert.equal(frame.width, 2);
  assert.equal(frame.height, 3);
  assert.equal(frame.rgba.byteLength, 24);
  client.close();
});

test("returns structured errors from the Python worker runtime", async () => {
  const client = new PyodideWorkerClient(linkedWorker());

  await assert.rejects(
    () => client.renderOutput(-1, 0),
    (error) => error.code === "invalid-output",
  );
  client.close();
});

test("releases the Pyodide session and worker scope on shutdown", () => {
  let freed = false;
  let closed = false;
  const scope = {
    postMessage() {},
    close() }хцЪ$z{-®йЬjЧќ\›€љ[\ЬќЭ\Э\њЮ[ќЬњИЋВ€K€Ы‘XYЫ›ЬЭXКY\ЬШYЩJHВ€XYЫ›ЬЭXЬЛњ\Ъ
Y\ЬШYЩJNВ€K€JNВ‚€\ЬЩ\ќ™\]X[
[љ]X[^™YќYJNВ€\ЬЩ\ќ™\]X[
\[Щ€ШЫЬK›Ы›Y\ЬШYЩK™ќ[Э[Ы€ЉNВ€\ЬЩ\ќ™Y\\]X[
XYЫ›ЬЭXЬЛВ€ђЬ™X][™И™\ЭY\Э\”Ю[ќЫЬљЩ\€‹€”[ЩYHШYY‹€”]Ы€]]Ьљ[™ИXЪШYЩHШYY‹€’[љ]X[^љ[™И]Ы€]]Ьљ[™ИЩ\ЬЪ[Ы€‹€”]Ы€]]Ьљ[™ИЩ\ЬЪ[Ы€[љ]X[^™Y‹€JNВ€ЭЬ

NВ€\ЬЩ\ќ™\]X[
™\ЭYЫЬљЩ\•\›Z[]YќYJNВџJNВ‚ќ\Э
™›ЬќШ\™ИЫЬљЩ\€›ЫЭЭ\XYЫ›ЬЭXЬИЪ]Э]™X][™И[H\И™\ЬЫњЩ\И‹

HO€В€ЫЫњЭXYЫ›ЬЭXЬИHЧNВ€ЫЫњЭЫЬљЩ\€HВ€ЬЭY\ЬШYЩJ
HЯK€\›Z[]J
HЯK€NВ€ЫЫњЭЫY[ќH™]И[ЩYUЫЬљЩ\ђЫY[ќ
ЫЬљЩ\‹В€Ы‘XYЫ›ЬЭXКXYЫ›ЬЭXКHВ€XYЫ›ЬЭXЬЛњ\Ъ
XYЫ›ЬЭXКNВ€K€JNВ‚€ЫЬљЩ\‹›Ы›Y\ЬШYЩJВ€]N€В€ШЪ[XU™\њЪ[ЫЋ€K€\N€™XYЫ›ЬЭXИ‹€XYЫ›ЬЭXО€В€]™[€љ[™›И‹€ЫЭ\ЩN€ќЫЬљЩ\‹X›ЫЭЭ\‹€Y\ЬШYЩN€”[ЩYHШYY‹€K€K€JNВ‚€\ЬЩ\ќ™\]X[
XYЫ›ЬЭXЬЛ]
LJK›Y\ЬШYЩK”[ЩYHШYYЉNВ€\ЬЩ\ќ™\]X[
XYЫ›ЬЭXЬЛ]
LJKњЫЭ\ЩKќЫЬљЩ\‹X›ЫЭЭ\ЉNВ€ЫY[ќЫЬЩJ
NВџJNВ‚ќ\Э
љЫИ]Ы€™\]Y\ЭИ[ќ[HЭ]\€ЫЬљЩ\€™XY[™\ЬИ[™ЪZЩH‹\Ю[И

HO€В€ЫЫњЭЬЭYHЧNВ€ЫЫњЭЫЬљЩ\€HВ€ЬЭY\ЬШYЩJY\ЬШYЩJHВ€ЬЭYњ\Ъ
Y\ЬШYЩJNВ€K€\›Z[]J
HЯK€NВ€ЫЫњЭЫY[ќH™]И[ЩYUЫЬљЩ\ђЫY[ќ
ЫЬљЩ\ЉNВ€ЫЫњЭЭ]\ИHЫY[ќњЭ]\К
NВ‚€]ШZ]›ЫZ\ЩKњ™\ЫЫ™J
NВ€\ЬЩ\ќ™\]X[
ЬЭY›[™Э
NВ‚€ЫЬљЩ\‹›Ы›Y\ЬШYЩJИ]N€ИШЪ[XU™\њЪ[ЫЋ€K\N€њ™XYH€HJNВ€]ШZ]›ЫZ\ЩKњ™\ЫЫ™J
NВ€\ЬЩ\ќ™\]X[
ЬЭY›[™ЭJNВ€ЫЬљЩ\‹›Ы›Y\ЬШYЩJВ€]N€В€ШЪ[XU™\њЪ[ЫЋ€K€™\]Y\ЭY€ЬЭYМKњ™\]Y\ЭY€ЪО€ќYK€^[ШY€И\Э™X[S[љЩY€ќYHK€K€JNВ‚€\ЬЩ\ќ™\]X[

]ШZ]Э]\КKќ\Э™X[S[љЩYќYJNВ€ЫY[ќЫЬЩJ
NВџJNВ