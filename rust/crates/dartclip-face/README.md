# dartclip-face

Face detection, speaker reframing, shot cuts, and facecam layout analysis. The
ONNX model is embedded and inference runs in-process with `tract-onnx`, without
OpenCV, MediaPipe, or an external inference runtime. Video inputs require
`ffmpeg` and `ffprobe` on `PATH`; PNG cover analysis does not.

`models/face_detection_yunet_2023mar.onnx` is the unmodified [OpenCV Zoo YuNet
model](https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet)
(232,589 bytes; license in `models/YUNET-LICENSE`). SHA-256:
`8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`.

The tests use a [NASA public-domain photograph of Eileen Collins](https://github.com/scikit-image/scikit-image/blob/v0.24.0/skimage/data/astronaut.png)
from scikit-image's test data (`tests/fixtures/astronaut.png`).
