# Playback fixtures

`direct.mp4` and `hls/` were generated locally from FFmpeg's mathematical test pattern and sine-wave audio. They contain no third-party movie footage. The MP4 is 12 seconds, 160×90 H.264 with English/German-labelled AAC test tones. HLS uses two-second H.264/AAC MPEG-TS segments.

They test browser decoding, range seeking and the private HLS proxy. They do not prove that a real Jellyfin server's hardware transcode configuration works.

Generation: FFmpeg `testsrc2=size=160x90:rate=12`, two sine inputs, `libx264`, `yuv420p`, GOP 24, AAC, then `-c copy -hls_time 2 -hls_playlist_type vod`. Fixtures are excluded from the runtime Docker image.
