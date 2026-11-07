import argparse
import hashlib
import json
import time

import numpy as np
import torch
from network import GlyphStyleCNN, device

from data import Dataset, atomic_json


def train(path, steps=1000, seed=1729):
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    torch.set_num_threads(4)
    ds = Dataset(path)
    dev = device()
    model = GlyphStyleCNN().to(dev)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    cases = [
        (fi, ci) for fi in ds.train for ci in range(len(ds.chars)) if ds.present[fi, ci]
    ]
    donors = {
        ci: [fi for fi in ds.train if ds.present[fi, ci]] for ci in range(len(ds.chars))
    }
    start = time.perf_counter()
    losses = []
    for step in range(steps):
        samples = [cases[i] for i in rng.integers(0, len(cases), 32)]
        content = []
        refs = []
        target = []
        for fi, ci in samples:
            pool = [i for i in donors[ci] if i != fi]
            if not pool:
                continue
            donor = int(rng.choice(pool))
            content.append(ds.images[donor, ci])
            refs.append(ds.references(fi, ds.chars[ci]))
            target.append(ds.images[fi, ci])
        if not target:
            continue
        x = torch.tensor(np.array(content)[:, None], dtype=torch.float32, device=dev)
        r = torch.tensor(np.array(refs), device=dev)
        y = torch.tensor(np.array(target)[:, None], dtype=torch.float32, device=dev)
        optimizer.zero_grad()
        logits = model(x, r)
        p = logits.sigmoid()
        bce = torch.nn.functional.binary_cross_entropy_with_logits(logits, y)
        dice = (
            1
            - (
                (2 * (p * y).sum((1, 2, 3)) + 1)
                / (p.sum((1, 2, 3)) + y.sum((1, 2, 3)) + 1)
            ).mean()
        )
        loss = bce + dice
        loss.backward()
        optimizer.step()
        losses.append(float(loss.detach().cpu()))
        if (step + 1) % 100 == 0:
            print(
                json.dumps(
                    {
                        "step": step + 1,
                        "loss": round(float(np.mean(losses[-100:])), 4),
                        "seconds": round(time.perf_counter() - start, 1),
                        "device": str(dev),
                    }
                ),
                flush=True,
            )
    model = model.to("cpu")
    torch.save(model.state_dict(), ds.path / "cnn.pt")
    report = {
        "model": "para-style-cnn-v1",
        "parameters": sum(p.numel() for p in model.parameters()),
        "steps": steps,
        "seed": seed,
        "device": str(dev),
        "seconds": time.perf_counter() - start,
        "snapshot": ds.meta["snapshot"],
        "trainingFontIds": [ds.fonts[i]["id"] for i in ds.train],
        "testFontIds": [ds.fonts[i]["id"] for i in ds.test],
        "checkpointSha256": hashlib.sha256(
            (ds.path / "cnn.pt").read_bytes()
        ).hexdigest(),
        "testUsedForCheckpointSelection": False,
        "donorPolicy": "Different font, same character, training split only; same-family training pairs allowed; test families never used",
    }
    atomic_json(ds.path / "training.json", report)
    print(
        json.dumps(
            {
                k: v
                for k, v in report.items()
                if k not in ["trainingFontIds", "testFontIds"]
            }
        ),
        flush=True,
    )


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--data", required=True)
    p.add_argument("--steps", type=int, default=1000)
    a = p.parse_args()
    train(a.data, a.steps)
