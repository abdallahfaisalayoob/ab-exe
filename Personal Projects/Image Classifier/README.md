# Image Classifier — Neural Network from Scratch

> **No TensorFlow. No PyTorch. Pure math.**  
> A feedforward neural network implemented from scratch in both **Python (NumPy)** and **C++** to classify handwritten digits from the MNIST dataset.

---

## Architecture

```
Input (784) -> Dense (128, ReLU) -> Dense (64, ReLU) -> Output (10, Softmax)
```

- **Loss**: Categorical Cross-Entropy  
- **Optimiser**: Mini-batch Gradient Descent  
- **Weight Init**: Xavier (He) initialisation  
- **Expected accuracy**: ~97% (Python) / ~95% (C++) on MNIST test set  

---

## Python

### Setup
```bash
cd python
pip install numpy
```

### Train
```bash
python train.py
```
Downloads MNIST automatically, trains for 25 epochs, saves weights to `model.npz`.

### Predict
```bash
python predict.py
```
Loads the saved model, prints test accuracy, and shows 5 random predictions as ASCII art digits.

### File breakdown

| File | Purpose |
|---|---|
| `neural_net.py` | Full NN class: forward pass, backprop, train, predict, save/load |
| `data_loader.py` | Downloads and parses MNIST binary files |
| `train.py` | Training entry point |
| `predict.py` | Inference and ASCII visualisation |

---

## C++

### Setup
Download the 4 MNIST binary files (unzipped) and place them in `cpp/data/`:
- `train-images-idx3-ubyte`
- `train-labels-idx1-ubyte`
- `t10k-images-idx3-ubyte`
- `t10k-labels-idx1-ubyte`

### Compile and run
```bash
cd cpp
make
./classifier
```

### File breakdown

| File | Purpose |
|---|---|
| `matrix.hpp` | Matrix class with matmul, transpose, ReLU, softmax |
| `neural_net.hpp` | NN class: forward, backward, update, save/load |
| `data_loader.hpp` | MNIST IDX binary file parser |
| `main.cpp` | Training loop, evaluation, entry point |
| `Makefile` | Build config |

---

## What's implemented from scratch

- Matrix multiplication
- Xavier weight initialisation
- ReLU and Softmax activations
- Cross-entropy loss
- Full backpropagation
- Mini-batch gradient descent
- Model save/load (`.npz` for Python, binary for C++)

---

*Author: Abdallah Faisal Ayoob — 23i-6058, NUCES*
