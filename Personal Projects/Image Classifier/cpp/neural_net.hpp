/**
 * neural_net.hpp
 * ==============
 * Feedforward neural network with backpropagation.
 * Built on top of matrix.hpp — no ML libraries used.
 *
 * Author: Abdallah Faisal Ayoob
 */

#pragma once
#include "matrix.hpp"
#include <vector>
#include <string>
#include <fstream>
#include <iostream>

struct LayerCache {
    Matrix Z;   // Pre-activation
    Matrix A;   // Post-activation
};

class NeuralNetwork {
public:
    std::vector<int>    layer_sizes;
    std::vector<Matrix> weights;
    std::vector<Matrix> biases;
    double              lr;

    NeuralNetwork(std::vector<int> sizes, double learning_rate = 0.01)
        : layer_sizes(sizes), lr(learning_rate)
    {
        for (int i = 0; i < (int)sizes.size() - 1; ++i) {
            weights.push_back(Matrix::xavier(sizes[i], sizes[i + 1]));
            biases.push_back(Matrix::zeros(1, sizes[i + 1]));
        }
    }

    // ── Forward pass ─────────────────────────────────────────────────────────

    /**
     * Run X through the network.
     * Returns output probabilities; fills `cache` with intermediate values.
     */
    Matrix forward(const Matrix& X, std::vector<LayerCache>& cache) const {
        cache.clear();
        Matrix A = X;

        for (int i = 0; i < (int)weights.size(); ++i) {
            Matrix Z = A.matmul(weights[i]).add_row_vector(biases[i]);

            Matrix A_next = (i == (int)weights.size() - 1)
                            ? Z.softmax()
                            : Z.relu();

            cache.push_back({Z, A_next});
            A = A_next;
        }
        return A;
    }

    // ── Loss ─────────────────────────────────────────────────────────────────

    double cross_entropy(const Matrix& y_pred, const Matrix& y_true) const {
        int n = y_pred.rows;
        double loss = 0.0;
        for (int i = 0; i < n; ++i)
            for (int j = 0; j < y_pred.cols; ++j)
                loss -= y_true.at(i, j) * std::log(y_pred.at(i, j) + 1e-8);
        return loss / n;
    }

    // ── Backward pass ─────────────────────────────────────────────────────────

    void backward(const Matrix& X, const Matrix& y_true,
                  const std::vector<LayerCache>& cache,
                  std::vector<Matrix>& dW, std::vector<Matrix>& db) const
    {
        int n_layers = weights.size();
        int n        = X.rows;
        dW.resize(n_layers);
        db.resize(n_layers);

        // Output gradient: softmax + cross-entropy combined derivative
        Matrix dA = cache.back().A - y_true;

        for (int i = n_layers - 1; i >= 0; --i) {
            const Matrix& A_prev = (i == 0) ? X : cache[i - 1].A;

            dW[i] = A_prev.transpose().matmul(dA) * (1.0 / n);
            db[i] = dA.col_sum() * (1.0 / n);

            if (i > 0) {
                Matrix dA_prev = dA.matmul(weights[i].transpose());
                dA = dA_prev.hadamard(cache[i - 1].Z.relu_deriv());
            }
        }
    }

    // ── Update ───────────────────────────────────────────────────────────────

    void update(const std::vector<Matrix>& dW, const std::vector<Matrix>& db) {
        for (int i = 0; i < (int)weights.size(); ++i) {
            weights[i] -= dW[i] * lr;
            biases[i]  -= db[i] * lr;
        }
    }

    // ── Predict ──────────────────────────────────────────────────────────────

    std::vector<int> predict(const Matrix& X) const {
        std::vector<LayerCache> cache;
        Matrix probs = forward(X, cache);
        std::vector<int> preds(X.rows);
        for (int i = 0; i < X.rows; ++i) {
            int best = 0;
            for (int j = 1; j < probs.cols; ++j)
                if (probs.at(i, j) > probs.at(i, best)) best = j;
            preds[i] = best;
        }
        return preds;
    }

    double accuracy(const Matrix& X, const Matrix& y_true) const {
        auto preds = predict(X);
        int correct = 0;
        for (int i = 0; i < X.rows; ++i) {
            int true_label = 0;
            for (int j = 1; j < y_true.cols; ++j)
                if (y_true.at(i, j) > y_true.at(i, true_label)) true_label = j;
            if (preds[i] == true_label) ++correct;
        }
        return (double)correct / X.rows;
    }

    // ── Save / Load ──────────────────────────────────────────────────────────

    void save(const std::string& path) const {
        std::ofstream f(path, std::ios::binary);
        int n = weights.size();
        f.write((char*)&n, sizeof(int));
        for (int i = 0; i < n; ++i) {
            f.write((char*)&weights[i].rows, sizeof(int));
            f.write((char*)&weights[i].cols, sizeof(int));
            f.write((char*)weights[i].data.data(),
                    weights[i].data.size() * sizeof(double));
            f.write((char*)biases[i].data.data(),
                    biases[i].data.size() * sizeof(double));
        }
        std::cout << "Model saved to " << path << "\n";
    }

    void load(const std::string& path) {
        std::ifstream f(path, std::ios::binary);
        int n; f.read((char*)&n, sizeof(int));
        weights.resize(n); biases.resize(n);
        for (int i = 0; i < n; ++i) {
            int r, c;
            f.read((char*)&r, sizeof(int));
            f.read((char*)&c, sizeof(int));
            weights[i] = Matrix(r, c);
            biases[i]  = Matrix(1, c);
            f.read((char*)weights[i].data.data(), r * c * sizeof(double));
            f.read((char*)biases[i].data.data(),  c     * sizeof(double));
        }
        std::cout << "Model loaded from " << path << "\n";
    }
};
