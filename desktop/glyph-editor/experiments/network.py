"""Small original conditional CNN baseline, not FontDiffuser or MX-Font."""

import torch
from torch import nn


class GlyphStyleCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.style = nn.Sequential(
            nn.Conv2d(12, 16, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 32, 3, stride=2, padding=1),
            nn.ReLU(),
            nn.AdaptiveAvgPool2d(1),
        )
        self.content = nn.Sequential(
            nn.Conv2d(1, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 32, 3, padding=1),
            nn.ReLU(),
        )
        self.decoder = nn.Sequential(
            nn.Conv2d(64, 32, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(32, 16, 3, padding=1),
            nn.ReLU(),
            nn.Conv2d(16, 1, 1),
        )

    def forward(self, content, refs):
        style = self.style(refs).expand(-1, -1, content.shape[-2], content.shape[-1])
        return (content * 2 - 1) * 2 + self.decoder(
            torch.cat([self.content(content), style], dim=1)
        )


def device():
    return torch.device("mps" if torch.backends.mps.is_available() else "cpu")
