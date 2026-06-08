/**
 * main.cpp
 * ========
 * Train and evaluate a neural network on MNIST.
 * No ML libraries — pure C++ with our own matrix math.
 *
 * Compile:  make
 * Run:      ./classifier
 *
 * Author: Abdallah Faisal Ayoob
 */

#include "neural_net.hpp"
#include "data_loader.hpp"
#include <iostream>
#include <vector>
#include <algorithm>
#include <numeric>
#include <random>
#include <chrono>

// ── Config ───────────────────────────────────────────────────────────────────
const std::vector<int> LAYER_SIZES   = {784, 128, 64, 10};
const double           LEARNING_RATE = 0.05;
const int              EPOCHS        = 20;
const int              BATCH_SIZE    = 64;
const std::string      DATA_DIR      = "data/";
const std::string      MODEL_PATH    = "model.bin";

// ── Mini-batch extraction ─────────────────────────────────────────────────────
Matrix get_batch(const Matrix& M, const std::vector<int>& indices,
                 int start, int end) {
    int n = end - start;
    Matrix batch(n, M.cols);
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < M.cols; ++j)
            batch.at(i, j) = M.at(indices[start + i], j);
    return batch;
}

// ── Training loop ────────────────────────────────────────────────────────────
void train(NeuralNetwork& net, const Matrix& X, const Matrix& Y) {
    int n = X.rows;
    std::vector<int> idx(n);
    std::iota(idx.begin(), idx.end(), 0);
    std::mt19937 rng(42);

    for (int epoch = 1; epoch <= EPOCHS; ++epoch) {
        auto t_start = std::chrono::high_resolution_clock::now();
        std::shuffle(idx.begin(), idx.end(), rng);

        double total_loss = 0.0;
        int batches = 0;

        for (int start = 0; start + BATCH_SIZE <= n; start += BATCH_SIZE) {
            Matrix Xb = get_batch(X, idx, start, start + BATCH_SIZE);
            Matrix Yb = get_batch(Y, idx, start, start + BATCH_SIZE);

            std::vector<LayerCache> cache;
            Matrix out = net.forward(Xb, cache);

            total_loss += net.cross_entropy(out, Yb);

            std::vector<Matrix> dW, db;
            net.backward(Xb, Yb, cache, dW, db);
            net.update(dW, db);
            ++batches;
        }

        auto t_end = std::chrono::high_resolution_clock::now();
        double ms = std::chrono::duration<double, std::milli>(t_end - t_start).count();
        double acc = net.accuracy(X, Y);

        std::cout << "Epoch " << epoch << "/" << EPOCHS
                  << "  loss: " << total_loss / batches
                  << "  acc: "  << acc
                  << "  (" << (int)ms << " ms)\n";
    }
}

// ── Main ─────────────────────────────────────────────────────────────────────
int main() {
    std::cout << "=== MNIST Neural Network Classifier (C++) ===\n\n";
    std::cout << "Architecture: ";
    for (int s : LAYER_SIZES) std::cout << s << " ";
    std::cout << "\nLR=" << LEARNING_RATE << "  Epochs=" << EPOCHS
              << "  Batch=" << BATCH_SIZE << "\n\n";

    // Load data
    Matrix X_train = load_mnist_images(DATA_DIR + "train-images-idx3-ubyte");
    Matrix Y_train = load_mnist_labels(DATA_DIR + "train-labels-idx1-ubyte");
    Matrix X_test  = load_mnist_images(DATA_DIR + "t10k-images-idx3-ubyte");
    Matrix Y_test  = load_mnist_labels(DATA_DIR + "t10k-labels-idx1-ubyte");
    std::cout << "\n";

    // Build network
    NeuralNetwork net(LAYER_SIZES, LEARNING_RATE);

    // Train
    std::cout << "Training...\n";
    train(net, X_train, Y_train);

    // Evaluate
    double test_acc = net.accuracy(X_test, Y_test);
    std::cout << "\nTest accuracy: " << test_acc * 100.0 << "%\n";

    // Save
    net.save(MODEL_PATH);

    return 0;
}
