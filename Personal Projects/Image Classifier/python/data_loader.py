"""
data_loader.py
==============
Downloads and preprocesses the MNIST handwritten digit dataset.
Returns numpy arrays ready for training.

Author: Abdallah Faisal Ayoob
"""

import numpy as np
import os
import struct
import urllib.request
import gzip

# MNIST mirror URLs
MNIST_URLS = {
    "train_images": "https://storage.googleapis.com/cvdf-datasets/mnist/train-images-idx3-ubyte.gz",
    "train_labels": "https://storage.googleapis.com/cvdf-datasets/mnist/train-labels-idx1-ubyte.gz",
    "test_images":  "https://storage.googleapis.com/cvdf-datasets/mnist/t10k-images-idx3-ubyte.gz",
    "test_labels":  "https://storage.googleapis.com/cvdf-datasets/mnist/t10k-labels-idx1-ubyte.gz",
}


def download_mnist(data_dir="data"):
    """Download MNIST files if not already present."""
    os.makedirs(data_dir, exist_ok=True)
    for name, url in MNIST_URLS.items():
        filepath = os.path.join(data_dir, os.path.basename(url))
        if not os.path.exists(filepath):
            print(f"Downloading {name}...")
            urllib.request.urlretrieve(url, filepath)
    print("MNIST ready.")


def load_images(filepath):
    with gzip.open(filepath, "rb") as f:
        _, n, rows, cols = struct.unpack(">IIII", f.read(16))
        images = np.frombuffer(f.read(), dtype=np.uint8)
        images = images.reshape(n, rows * cols)
    return images


def load_labels(filepath):
    with gzip.open(filepath, "rb") as f:
        struct.unpack(">II", f.read(8))
        labels = np.frombuffer(f.read(), dtype=np.uint8)
    return labels


def one_hot(labels, n_classes=10):
    """Convert integer labels to one-hot encoded matrix."""
    n = len(labels)
    oh = np.zeros((n, n_classes))
    oh[np.arange(n), labels] = 1
    return oh


def load_mnist(data_dir="data"):
    """
    Load MNIST, normalise pixels to [0, 1], and one-hot encode labels.
    Returns: X_train, y_train, X_test, y_test
    """
    download_mnist(data_dir)

    X_train = load_images(os.path.join(data_dir, "train-images-idx3-ubyte.gz")) / 255.0
    y_train = load_labels(os.path.join(data_dir, "train-labels-idx1-ubyte.gz"))
    X_test  = load_images(os.path.join(data_dir, "t10k-images-idx3-ubyte.gz"))  / 255.0
    y_test  = load_labels(os.path.join(data_dir, "t10k-labels-idx1-ubyte.gz"))

    print(f"Train: {X_train.shape[0]} samples | Test: {X_test.shape[0]} samples")
    return X_train, one_hot(y_train), X_test, one_hot(y_test)
