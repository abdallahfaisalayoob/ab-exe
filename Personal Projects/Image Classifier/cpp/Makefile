CXX      = g++
CXXFLAGS = -std=c++17 -O2 -Wall -Wextra
TARGET   = classifier
SRC      = main.cpp

all: $(TARGET)

$(TARGET): $(SRC) matrix.hpp neural_net.hpp data_loader.hpp
	$(CXX) $(CXXFLAGS) -o $(TARGET) $(SRC)

clean:
	rm -f $(TARGET) model.bin
