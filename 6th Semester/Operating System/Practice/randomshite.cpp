#include <iostream>
#include <string>
#include <vector>
using namespace std;

struct Student {
    int id;
    string name;
    string email;
    string phoneNumber;
    string major;
    vector<string> classes;
};

class School {
private:
    vector<Student> students;
    int nextId = 1;

public:
    void registerStudent() {
        Student newStudent;
        newStudent.id = nextId++;
        
        cout << "=== Student Registration ===" << endl;
        cout << "Enter name: ";
        getline(cin, newStudent.name);
        
        cout << "Enter email: ";
        getline(cin, newStudent.email);
        
        cout << "Enter phone number: ";
        getline(cin, newStudent.phoneNumber);
        
        cout << "Enter major: ";
        getline(cin, newStudent.major);
        
        cout << "How many classes to enroll? ";
        int numClasses;
        cin >> numClasses;
        cin.ignore();
        
        for (int i = 0; i < numClasses; i++) {
            string className;
            cout << "Enter class " << (i + 1) << ": ";
            getline(cin, className);
            newStudent.classes.push_back(className);
        }
        
        students.push_back(newStudent);
        cout << "Registration successful! Student ID: " << newStudent.id << endl << endl;
    }
    
    void displayStudent(int id) {
        for (const auto& student : students) {
            if (student.id == id) {
                cout << "=== Student Information ===" << endl;
                cout << "ID: " << student.id << endl;
                cout << "Name: " << student.name << endl;
                cout << "Email: " << student.email << endl;
                cout << "Phone: " << student.phoneNumber << endl;
                cout << "Major: " << student.major << endl;
                cout << "Classes: ";
                for (const auto& cls : student.classes) {
                    cout << cls << " ";
                }
                cout << endl << endl;
                return;
            }
        }
        cout << "Student not found!" << endl;
    }
};

int main() {
    School school;
    int choice;
    
    while (true) {
        cout << "1. Register Student" << endl;
        cout << "2. View Student" << endl;
        cout << "3. Exit" << endl;
        cout << "Enter choice: ";
        cin >> choice;
        cin.ignore();
        
        if (choice == 1) {
            school.registerStudent();
        } else if (choice == 2) {
            int id;
            cout << "Enter student ID: ";
            cin >> id;
            cin.ignore();
            school.displayStudent(id);
        } else if (choice == 3) {
            break;
        }
    }
    
    return 0;
}