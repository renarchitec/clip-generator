# PyInstaller spec: worker lokal DartClip untuk macOS arm64 (desktop spike).
# Build lewat worker/desktop/build-mac.sh, bukan langsung.
# onedir (bukan onefile): onefile mengekstrak ~ratusan MB ke /tmp setiap start.
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

datas = collect_data_files("mediapipe", includes=["**/*.tflite", "**/*.binarypb", "**/*.txt"])
datas += [("../fonts", "fonts")]

a = Analysis(
    ["entry.py"],
    pathex=[".."],
    datas=datas,
    hiddenimports=collect_submodules("yt_dlp") + ["clipper.local_cli"],
    # Jalur server saja / tidak dipakai di lokal.
    excludes=["bullmq", "redis", "tkinter", "matplotlib.tests", "IPython", "jax", "jaxlib"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="dartclip-worker",
    console=True,
    target_arch="arm64",
    upx=False,
)
coll = COLLECT(exe, a.binaries, a.datas, name="dartclip-worker", upx=False)
