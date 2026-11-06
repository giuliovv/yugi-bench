"""Export the NumPy checkpoint as static-browser-friendly JSON."""

import json
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parents[1]
checkpoint = ROOT / "models/smoke_policy.npz"
output = ROOT / "models/smoke_policy.json"
with np.load(checkpoint, allow_pickle=False) as model:
    data = {key: model[key].tolist() for key in (
        "feature_version", "hidden", "w_state", "b_state", "w_policy", "b_policy", "w_logit", "b_logit")}
output.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
print(f"{output}: {output.stat().st_size} bytes")
