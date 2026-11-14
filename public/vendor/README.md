# Bundled HLS.js

HLS.js 1.7.4, from the pinned npm `hls.js` development dependency. `hls.min.mjs` and `hls.worker.js` are copied from its `dist` directory with source-map trailer comments removed. The standalone worker stays adjacent to the module for local worker loading. Upstream license is preserved as `hls.LICENSE`.

Upstream: https://github.com/video-dev/hls.js/tree/v1.7.4

The player imports this module only when a negotiated HLS stream needs MediaSource playback. Safari/native-HLS browsers use the native path. No runtime package installation or CDN connection is needed by the Docker image.
