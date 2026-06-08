#include <iostream>
#include <pthread.h>
#include <unistd.h> // For getpid()

using namespace std;

// This function is executed by the second thread
void *inc_x(void *arg) {
    // Print process and thread IDs
    cout << "Thread: Process ID is " << getpid() << " and Thread ID is " << pthread_self() << endl;
    
    int *input = (int *)arg; // Typecasting argument to integer  
                             //pointer
    
    // Increment x to 100
    while (++(*input) < 100);
    
    cout << "x increment finished" << endl;
    
    // The function must return something - NULL will do
    pthread_exit(NULL);
}

int main() { // Main thread
    int x = 0, y = 0;
    
    // Show the initial values of x and y
    cout << "Initial values - x: " << x << ", y: " << y << endl;
    cout << "Main: Process ID is " << getpid() << " and Thread ID is " << pthread_self() << endl;
    
    // Declare a thread variable
    pthread_t thread_2;
    
    // Create a second thread that executes inc_x(&x)
    pthread_create(&thread_2, NULL, inc_x, &x);
    
    // Increment y to 100 in the main thread
    while (++y < 100);
    cout << "y increment finished" << endl;
    
    // Wait for the second thread to finish
    pthread_join(thread_2, NULL);
    
    // Show the final values - x is now 100 thanks to the second    
    //thread
    cout << "Final values - x: " << x << ", y: " << y << endl;
    
    pthread_exit(NULL);
}