"""Fine-tune EfficientNet-Lite0 (default) or MobileNetV3-Small on the 9 iREPORT classes.

Data layout (ImageFolder), one folder per class, already split:

    ml/data/images/{train,val,test}/{Pothole,Road Damage,Streetlight,Garbage,Water Leakage,Drainage,Electrical Hazard,Other,not_civic}/*.jpg

See ml/README.md for where the images come from (RDD2022, Kaggle pothole sets, TrashNet, TACO,
photos collected and pre-labelled offline with MobileCLIP and then checked by hand).

    python ml/train_image.py --epochs 25                  # EfficientNet-Lite0
    python ml/train_image.py --arch mobilenetv3_small_100  # smaller file

Writes ml/runs/<version>/best.pt and a temperature fitted on the validation set (calibration).
"""

import argparse
import json
import time
from pathlib import Path

import torch
import torch.nn.functional as F
from torch import nn
from torch.utils.data import DataLoader, WeightedRandomSampler
from torchvision import datasets, transforms

ROOT = Path(__file__).resolve().parents[1]
LABELS = ["Pothole", "Road Damage", "Streetlight", "Garbage", "Water Leakage", "Drainage", "Electrical Hazard", "Other", "not_civic"]
# EfficientNet-Lite (TF port) was trained with mean = std = 0.5; MobileNetV3 with ImageNet stats.
NORMALISE = {"tf_efficientnet_lite0": ([0.5] * 3, [0.5] * 3), "mobilenetv3_small_100": ([0.485, 0.456, 0.406], [0.229, 0.224, 0.225])}


def loaders(data: Path, arch: str, size: int, batch: int):
    mean, std = NORMALISE[arch]
    train_tf = transforms.Compose([
        transforms.RandomResizedCrop(size, scale=(0.6, 1.0)), transforms.RandomHorizontalFlip(),
        transforms.ColorJitter(0.3, 0.3, 0.2, 0.02), transforms.RandomRotation(10),
        transforms.ToTensor(), transforms.Normalize(mean, std),
    ])
    eval_tf = transforms.Compose([transforms.Resize(round(size / 0.875)), transforms.CenterCrop(size), transforms.ToTensor(), transforms.Normalize(mean, std)])
    train = datasets.ImageFolder(data / "train", train_tf)
    val = datasets.ImageFolder(data / "val", eval_tf)
    if train.classes != sorted(LABELS) or val.classes != train.classes:
        raise SystemExit(f"class folders must be exactly {sorted(LABELS)}; found {train.classes}")
    # Public data is very unbalanced (many potholes, few streetlights): sample classes evenly.
    counts = torch.bincount(torch.tensor(train.targets), minlength=len(train.classes)).float()
    weights = (1.0 / counts.clamp(min=1))[train.targets]
    return (
        DataLoader(train, batch, sampler=WeightedRandomSampler(weights, len(train), replacement=True), num_workers=4),
        DataLoader(val, batch, num_workers=4),
        train.classes,
    )


def fit_temperature(logits: torch.Tensor, targets: torch.Tensor) -> float:
    """Temperature scaling (Guo et al. 2017) on validation logits, so confidence means something."""
    t = torch.ones(1, requires_grad=True)
    opt = torch.optim.LBFGS([t], lr=0.05, max_iter=200)

    def closure():
        opt.zero_grad()
        loss = F.cross_entropy(logits / t.clamp(min=0.05), targets)
        loss.backward()
        return loss

    opt.step(closure)
    return float(t.clamp(min=0.05).item())


@torch.no_grad()
def collect(model, loader, device):
    model.eval()
    out, ys = [], []
    for x, y in loader:
        out.append(model(x.to(device)).cpu())
        ys.append(y)
    return torch.cat(out), torch.cat(ys)


def main() -> None:
    import timm

    ap = argparse.ArgumentParser()
    ap.add_argument("--data", type=Path, default=ROOT / "ml/data/images")
    ap.add_argument("--arch", default="tf_efficientnet_lite0", choices=list(NORMALISE))
    ap.add_argument("--version", default="img-1.0")
    ap.add_argument("--epochs", type=int, default=25)
    ap.add_argument("--batch", type=int, default=64)
    ap.add_argument("--lr", type=float, default=3e-4)
    ap.add_argument("--size", type=int, default=224)
    args = ap.parse_args()

    device = "cuda" if torch.cuda.is_available() else "cpu"
    train_dl, val_dl, folder_classes = loaders(args.data, args.arch, args.size, args.batch)
    model = timm.create_model(args.arch, pretrained=True, num_classes=len(LABELS)).to(device)
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.05)
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=args.lr, total_steps=args.epochs * len(train_dl))
    out = ROOT / "ml/runs" / args.version
    out.mkdir(parents=True, exist_ok=True)
    best = 0.0
    for epoch in range(args.epochs):
        model.train()
        start = time.time()
        for x, y in train_dl:
            opt.zero_grad()
            loss = F.cross_entropy(model(x.to(device)), y.to(device), label_smoothing=0.1)
            loss.backward()
            opt.step()
            sched.step()
        logits, ys = collect(model, val_dl, device)
        acc = (logits.argmax(1) == ys).float().mean().item()
        print(f"epoch {epoch + 1}/{args.epochs} val_acc={acc:.3f} ({time.time() - start:.0f}s)")
        if acc > best:
            best = acc
            torch.save(model.state_dict(), out / "best.pt")
    model.load_state_dict(torch.load(out / "best.pt", map_location=device))
    logits, ys = collect(model, val_dl, device)
    temperature = fit_temperature(logits, ys)
    # ImageFolder sorts classes alphabetically; record that order so export can map it to LABELS.
    (out / "train.json").write_text(json.dumps({"arch": args.arch, "folder_classes": folder_classes, "labels": LABELS, "temperature": temperature, "val_accuracy": best, "input_size": args.size, "mean": NORMALISE[args.arch][0], "std": NORMALISE[args.arch][1]}, indent=2))
    print(f"best val acc {best:.3f}, temperature {temperature:.3f} -> {out}")


if __name__ == "__main__":
    main()
