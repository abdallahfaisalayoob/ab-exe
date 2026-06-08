#include <iostream>
#include <string>
using namespace std;

// Structure for basic student data
struct StudentInfo {
    string name;
    int rollNumber;
    int age;
    string department;
    string email;
};

// Class for Student with methods to input and display info
class Student {
private:
    string name;
    int rollNumber;
    int age;
    string department;
    string email;

public:
    // Method to enter student information
    void enterInfo() {
        cout << "\n--- Enter Student Information ---\n";
        cout << "Name: ";
        getline(cin, name);
        cout << "Roll Number: ";
        cin >> rollNumber;
        cout << "Age: ";
        cin >> age;
        cin.ignore();  // Clear newline left in buffer
        cout << "Department: ";
        getline(cin, department);
        cout << "Email: ";
        getline(cin, email);
    }

    // Method to display student information
    void displayInfo() {
        cout << "\n--- Student Information ---\n";
        cout << "Name: " << name << "\n";
        cout << "Roll Number: " << rollNumber << "\n";
        cout << "Age: " << age << "\n";
        cout << "Department: " << department << "\n";
        cout << "Email: " << email << "\n";
    }
};

int main() {
    // Using the Student class
    Student student;
    student.enterInfo();
    student.displayInfo();

    // Optional: Using the struct for another student
    cout << "\n--- Using struct for another student ---\n";
    StudentInfo s2;
    cout << "Name: ";
    getline(cin, s2.name);
    cout << "Roll Number: ";
    cin >> s2.rollNumber;
    cout << "Age: ";
    cin >> s2.age;
    cin.ignore();
    cout << "Department: ";
    getline(cin, s2.department);
    cout << "Email: ";
    getline(cin, s2.email);

    cout << "\n--- Student (struct) ---\n";
    cout << "Name: " << s2.name << "\n";
    cout << "Roll Number: " << s2.rollNumber << "\n";
    cout << "Age: " << s2.age << "\n";
    cout << "Department: " << s2.department << "\n";
    cout << "Email: " << s2.email << "\n";

    return 0;
}
