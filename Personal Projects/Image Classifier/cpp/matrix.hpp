/**
 * matrix.hpp
 * ==========
 * A minimal matrix class for ML math — no external dependencies.
 * Supports: add, subtract, multiply (matmul), transpose,
 *           element-wise ops, and ReLU / softmax.
 *
 * Author: Abdallah Faisal Ayoob
 */

#pragma once
#include <vector>
#include <stdexcept>
#include <cmath>
#include <algorithm>
#include <iostream>
#include <random>

class Matrix {
public:
    int rows, cols;
    std::vector<double> data;

    Matrix() : rows(0), cols(0) {}
    Matrix(int r, int c, double val = 0.0)
        : rows(r), cols(c), data(r * c, val) {}

    double& at(int r, int c)       { return data[r * cols + c]; }
    double  at(int r, int c) const { return data[r * cols + c]; }

    // ── Initialisers ─────────────────────────────────────────────────────────

    static Matrix zeros(int r, int c) { return Matrix(r, c, 0.0); }

    static Matrix xavier(int r, int c) {
        Matrix m(r, c);
        double scale = std::sqrt(2.0 / r);
        std::mt19937 rng(std::random_device{}());
        std::normal_distribution<double> dist(0.0, scale);
        for (auto& v : m.data) v = dist(rng);
        return m;
    }

    // ── Arithmetic ───────────────────────────────────────────────────────────

    Matrix operator+(const Matrix& o) const {
        assert_same_shape(o);
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = data[i] + o.data[i];
        return res;
    }

    Matrix operator-(const Matrix& o) const {
        assert_same_shape(o);
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = data[i] - o.data[i];
        return res;
    }

    Matrix operator*(double scalar) const {
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = data[i] * scalar;
        return res;
    }

    // Element-wise multiply (Hadamard product)
    Matrix hadamard(const Matrix& o) const {
        assert_same_shape(o);
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = data[i] * o.data[i];
        return res;
    }

    // Matrix multiplication: (this) x (other)
    Matrix matmul(const Matrix& o) const {
        if (cols != o.rows)
            throw std::invalid_argument("matmul shape mismatch");
        Matrix res(rows, o.cols, 0.0);
        for (int i = 0; i < rows; ++i)
            for (int k = 0; k < cols; ++k)
                for (int j = 0; j < o.cols; ++j)
                    res.at(i, j) += at(i, k) * o.at(k, j);
        return res;
    }

    Matrix transpose() const {
        Matrix res(cols, rows);
        for (int i = 0; i < rows; ++i)
            for (int j = 0; j < cols; ++j)
                res.at(j, i) = at(i, j);
        return res;
    }

    // Add a row vector to every row of this matrix
    Matrix add_row_vector(const Matrix& row) const {
        if (row.rows != 1 || row.cols != cols)
            throw std::invalid_argument("add_row_vector shape mismatch");
        Matrix res(rows, cols);
        for (int i = 0; i < rows; ++i)
            for (int j = 0; j < cols; ++j)
                res.at(i, j) = at(i, j) + row.at(0, j);
        return res;
    }

    // Sum each column -> (1, cols)
    Matrix col_sum() const {
        Matrix res(1, cols, 0.0);
        for (int i = 0; i < rows; ++i)
            for (int j = 0; j < cols; ++j)
                res.at(0, j) += at(i, j);
        return res;
    }

    // ── Activations ──────────────────────────────────────────────────────────

    Matrix relu() const {
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = std::max(0.0, data[i]);
        return res;
    }

    Matrix relu_deriv() const {
        Matrix res(rows, cols);
        for (int i = 0; i < (int)data.size(); ++i)
            res.data[i] = (data[i] > 0) ? 1.0 : 0.0;
        return res;
    }

    // Row-wise softmax
    Matrix softmax() const {
        Matrix res(rows, cols);
        for (int i = 0; i < rows; ++i) {
            double max_val = *std::max_element(
                data.begin() + i * cols, data.begin() + (i + 1) * cols);
            double sum = 0.0;
            for (int j = 0; j < cols; ++j) {
                res.at(i, j) = std::exp(at(i, j) - max_val);
                sum += res.at(i, j);
            }
            for (int j = 0; j < cols; ++j)
                res.at(i, j) /= sum;
        }
        return res;
    }

    // ── Utility ──────────────────────────────────────────────────────────────

    void operator+=(const Matrix& o) {
        for (int i = 0; i < (int)data.size(); ++i) data[i] += o.data[i];
    }
    void operator-=(const Matrix& o) {
        for (int i = 0; i < (int)data.size(); ++i) data[i] -= o.data[i];
    }

    void print(int max_rows = 5) const {
        for (int i = 0; i < std::min(rows, max_rows); ++i) {
            for (int j = 0; j < cols; ++j)
                std::cout << at(i, j) << "\t";
            std::cout << "\n";
        }
    }

private:
    void assert_same_shape(const Matrix& o) const {
        if (rows != o.rows || cols != o.cols)
            throw std::invalid_argument("Matrix shape mismatch");
    }
};
