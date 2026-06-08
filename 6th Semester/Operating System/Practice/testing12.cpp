#include <iostream>
#include <fstream>
#include <string>

struct StudentInfo {
    std::string name;
    std::string email;
    std::string studentID;
    #include <iostream>
    #include <unistd.h>
    #include <sys/wait.h>

    int main() {
        pid_t pid1, pid2, pid3;
        
        // Create first child
        pid1 = fork();
        if (pid1 == 0) {
            std::cout << "Child 1 (PID: " << getpid() << ") is running" << std::endl;
            sleep(2);
            std::cout << "Child 1 exiting" << std::endl;
            return 0;
        }
        
        // Create second child
        pid2 = fork();
        if (pid2 == 0) {
            std::cout << "Child 2 (PID: " << getpid() << ") is running" << std::endl;
            sleep(3);
            std::cout << "Child 2 exiting" << std::endl;
            return 0;
        }
        
        // Create third child
        pid3 = fork();
        if (pid3 == 0) {
            std::cout << "Child 3 (PID: " << getpid() << ") is running" << std::endl;
            sleep(1);
            std::cout << "Child 3 exiting" << std::endl;
            return 0;
        }
        
        // Parent waits for all children
        std::cout << "Parent (PID: " << getpid() << ") created 3 children" << std::endl;
        wait(nullptr);
        wait(nullptr);
        wait(nullptr);
        std::cout << "Parent: All children completed" << std::endl;
        
        return 0;
    }
    std::string major;
    std::string phoneNumber;
};

void uploadStudentInfo(const StudentInfo& student) {
    std::ofstream file("student_info.txt", std::ios::app);
    
    if (!file.is_open()) {
        std::cerr << "Error opening file!" << std::endl;
        return;
    }
    
    file << "Name: " << student.name << std::endl;
    file << "Email: " << student.email << std::endl;
    file << "Student ID: " << student.studentID << std::endl;
    file << "Major: " << student.major << std::endl;
    file << "Phone: " << student.phoneNumber << std::endl;
    file << "---" << std::endl;
    
    file.close();
    std::cout << "Student info uploaded successfully!" << std::endl;
}

int main() {
    StudentInfo student;
    
    std::cout << "Enter student name: ";
    std::getline(std::cin, student.name);
    
    std::cout << "Enter email: ";
    std::getline(std::cin, student.email);
    
    std::cout << "Enter student ID: ";
    std::getline(std::cin, student.studentID);
    
    std::cout << "Enter major: ";
    std::getline(std::cin, student.major);
    
    std::cout << "Enter phone number: ";
    std::getline(std::cin, student.phoneNumber);
    
    uploadStudentInfo(student);
    
    return 0;
}