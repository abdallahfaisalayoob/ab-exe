/**
 * data_loader.hpp
 * ===============
 * Loads MNIST dataset from the binary IDX file format.
 * Place the 4 MNIST files (unzipped) in a "data/" subdirectory.
 *
 * Files needed:
 *   data/train-images-idx3-ubyte
 *   data/train-labels-idx1-ubyte
 *   data/t10k-images-idx3-ubyte
 *   data/t10k-labels-idx1-ubyte
 *
 * Author: Abdallah Faisal Ayoob
 */

#pragma once
#include "matrix.hpp"
#include <fstream>
#include <stdexcept>
#include <string>
#include <iostream>

// MNIST files are big-endian; swap bytes on little-endian machines
static int reverse_int(int i) {
    unsigned char c1, c2, c3, c4;
    c1 = i & 255; c2 = (i >> 8) & 255;
    c3 = (i >> 16) & 255; c4 = (i >> 24) & 255;
    return ((int)c1 << 24) | ((int)c2 << 16) | ((int)c3 << 8) | c4;
}

Matrix load_mnist_images(const std::string& path) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open: " + path);

    int magic, n, rows, cols;
    f.read((char*)&magic, 4); magic = reverse_int(magic);
    f.read((char*)&n,     4); n     = reverse_int(n);
    f.read((char*)&rows,  4); rows  = reverse_int(rows);
    f.read((char*)&cols,  4); cols  = reverse_int(cols);

    int pixels = rows * cols;
    Matrix X(n, pixels);
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < pixels; ++j) {
            unsigned char p;
            f.read((char*)&p, 1);
            X.at(i, j) = p / 255.0;   // normalise to [0, 1]
        }
    }
    std::cout << "Loaded " << n << " images from " << path << "\n";
    return X;
}

Matrix load_mnist_labels(const std::string& path, int n_classes = 10) {
    std::ifstream f(path, std::ios::binary);
    if (!f) throw std::runtime_error("Cannot open: " + path);

    int magic, n;
    f.read((char*)&magic, 4);
    f.read((char*)&n,     4); n = reverse_int(n);

    Matrix Y(n, n_classes, 0.0);   // one-hot
    for (int i = 0; i < n; ++i) {
        unsigned char label;
        f.read((char*)&label, 1);
        Y.at(i, (int)label) = 1.0;
    }
    std::cout << "Loaded " << n << " labels from " << path << "\n";
    return Y;
}
