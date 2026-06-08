"""
train.py
========
Train the neural network on MNIST and save the model weights.

Usage:
    python train.py

Author: Abdallah Faisal Ayoob
"""

import numpy as np
from neural_net import NeuralNetwork
from data_loader import load_mnist

# ── Config ───────────────────────────────────────────────────────────────────
LAYER_SIZES    = [784, 128, 64, 10]   # input -> hidden -> hidden -> output
LEARNING_RATE  = 0.05
EPOCHS         = 25
BATCH_SIZE     = 64
VAL_SPLIT      = 0.1                  # 10% of training set used for validation
MODEL_PATH     = "model"

# ── Load data ────────────────────────────────────────────────────────────────
X_train, y_train, X_test, y_test = load_mnist()

# Split off validation set
n_val = int(len(X_train) * VAL_SPLIT)
X_val, y_val       = X_train[:n_val], y_train[:n_val]
X_train, y_train   = X_train[n_val:], y_train[n_val:]

# ── Build and train ───────────────────────────────────────────────────────────
print("\nBuilding network:", " -> ".join(str(s) for s in LAYER_SIZES))
print(f"LR={LEARNING_RATE}  Epochs={EPOCHS}  Batch={BATCH_SIZE}\n")

model = NeuralNetwork(LAYER_SIZES, learning_rate=LEARNING_RATE)
history = model.train(X_train, y_train,
                      epochs=EPOCHS, batch_size=BATCH_SIZE,
                      X_val=X_val, y_val=y_val)

# ── Final test evaluation ─────────────────────────────────────────────────────
test_acc = model.evaluate(X_test, y_test)
print(f"\nTest accuracy: {test_acc * 100:.2f}%")

# ── Save weights ──────────────────────────────────────────────────────────────
model.save(MODEL_PATH)
