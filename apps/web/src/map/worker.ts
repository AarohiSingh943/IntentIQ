// MapLibre 6 loads its tile worker as a separate module. Bundlers cannot discover it from
// `import.meta.url`, so we hand it an explicit URL that Vite emits for both dev and build.
import { setWorkerUrl } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";

setWorkerUrl(workerUrl);
