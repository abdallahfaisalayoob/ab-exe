"""
neural_net.py
=============
A feedforward neural network built from scratch using only NumPy.
No TensorFlow, no PyTorch — pure math.

Architecture:
    Input (784) -> Hidden (128, ReLU) -> Hidden (64, ReLU) -> Output (10, Softmax)

Author: Abdallah Faisal Ayoob
"""

import numpy as np


class NeuralNetwork:
    def __init__(self, layer_sizes: list, learning_rate: float = 0.01):
        """
        Args:
            layer_sizes: List of neurons per layer e.g. [784, 128, 64, 10]
            learning_rate: Step size for gradient descent
        """
        self.lr = learning_rate
        self.weights = []
        self.biases = []

        # Xavier initialisation — keeps variance stable across deep layers
        for i in range(len(layer_sizes) - 1):
            scale = np.sqrt(2.0 / layer_sizes[i])
            W = np.random.randn(layer_sizes[i], layer_sizes[i + 1]) * scale
            b = np.zeros((1, layer_sizes[i + 1]))
            self.weights.append(W)
            self.biases.append(b)

    # ── Activations ──────────────────────────────────────────────────────────

    def relu(self, z):
        return np.maximum(0, z)

    def relu_derivative(self, z):
        return (z > 0).astype(float)

    def softmax(self, z):
        # Subtract max for numerical stability
        z -= np.max(z, axis=1, keepdims=True)
        exp_z = np.exp(z)
        return exp_z / np.sum(exp_z, axis=1, keepdims=True)

    # ── Forward pass ─────────────────────────────────────────────────────────

    def forward(self, X):
        """
        Run input X through the network.
        Returns output probabilities and cached values for backprop.
        """
        cache = {"A0": X}
        A = X

        for i, (W, b) in enumerate(zip(self.weights, self.biases)):
            Z = A @ W + b
            cache[f"Z{i+1}"] = Z

            # Last layer uses softmax; all others use ReLU
            if i == len(self.weights) - 1:
                A = self.softmax(Z)
            else:
                A = self.relu(Z)

            cache[f"A{i+1}"] = A

        return A, cache

    # ── Loss ─────────────────────────────────────────────────────────────────

    def cross_entropy_loss(self, y_pred, y_true):
        """
        Categorical cross-entropy loss.
        y_true: one-hot encoded labels (n_samples, n_classes)
        """
        n = y_true.shape[0]
        log_probs = -np.log(y_pred + 1e-8)
        loss = np.sum(y_true * log_probs) / n
        return loss

    # ── Backward pass ────────────────────────────────────────────────────────

    def backward(self, cache, y_true):
        """
        Compute gradients via backpropagation.
        Returns weight and bias gradients for all layers.
        """
        n = y_true.shape[0]
        n_layers = len(self.weights)
        grads_W = [None] * n_layers
        grads_b = [None] * n_layers

        # Gradient of softmax + cross-entropy (combined, clean derivative)
        dA = cache[f"A{n_layers}"] - y_true

        for i in reversed(range(n_layers)):
            A_prev = cache[f"A{i}"]

            dZ = dA
            grads_W[i] = (A_prev.T @ dZ) / n
            grads_b[i] = np.sum(dZ, axis=0, keepdims=True) / n

            if i > 0:
                dA = dZ @ self.weights[i].T
                dA = dA * self.relu_derivative(cache[f"Z{i}"])

        return grads_W, grads_b

    # ── Parameter update ─────────────────────────────────────────────────────

    def update_params(self, grads_W, grads_b):
        for i in range(len(self.weights)):
            self.weights[i] -= self.lr * grads_W[i]
            self.biases[i]  -= self.lr * grads_b[i]

    # ── Training ─────────────────────────────────────────────────────────────

    def train(self, X_train, y_train, epochs=20, batch_size=64,
              X_val=None, y_val=None):
        """
        Mini-batch gradient descent training loop.
        """
        n = X_train.shape[0]
        history = {"loss": [], "acc": [], "val_loss": [], "val_acc": []}

        for epoch in range(1, epochs + 1):
            # Shuffle training data each epoch
            idx = np.random.permutation(n)
            X_train, y_train = X_train[idx], y_train[idx]

            epoch_loss = 0
            for start in range(0, n, batch_size):
                X_batch = X_train[start:start + batch_size]
                y_batch = y_train[start:start + batch_size]

                y_pred, cache = self.forward(X_batch)
                loss = self.cross_entropy_loss(y_pred, y_batch)
                epoch_loss += loss

                grads_W, grads_b = self.backward(cache, y_batch)
                self.update_params(grads_W, grads_b)

            avg_loss = epoch_loss / (n // batch_size)
            train_acc = self.evaluate(X_train, y_train)
            history["loss"].append(avg_loss)
            history["acc"].append(train_acc)

            val_info = ""
            if X_val is not None:
                val_pred, _ = self.forward(X_val)
                val_loss = self.cross_entropy_loss(val_pred, y_val)
                val_acc = self.evaluate(X_val, y_val)
                history["val_loss"].append(val_loss)
                history["val_acc"].append(val_acc)
                val_info = f"  val_loss: {val_loss:.4f}  val_acc: {val_acc:.4f}"

            print(f"Epoch {epoch:>3}/{epochs}  "
                  f"loss: {avg_loss:.4f}  acc: {train_acc:.4f}{val_info}")

        return history

    # ── Inference ────────────────────────────────────────────────────────────

    def predict(self, X):
        """Returns predicted class indices."""
        probs, _ = self.forward(X)
        return np.argmax(probs, axis=1)

    def evaluate(self, X, y_true_onehot):
        """Returns accuracy as a float."""
        y_pred = self.predict(X)
        y_true = np.argmax(y_true_onehot, axis=1)
        return np.mean(y_pred == y_true)

    # ── Save / Load ──────────────────────────────────────────────────────────

    def save(self, filepath):
        """Save weights and biases to a .npz file."""
        data = {}
        for i, (W, b) in enumerate(zip(self.weights, self.biases)):
            data[f"W{i}"] = W
            data[f"b{i}"] = b
        np.savez(filepath, **data)
        print(f"Model saved to {filepath}.npz")

    def load(self, filepath):
        """Load weights and biases from a .npz file."""
        data = np.load(filepath)
        for i in range(len(self.weights)):
            self.weights[i] = data[f"W{i}"]
            self.biases[i]  = data[f"b{i}"]
        print(f"Model loaded from {filepath}")
