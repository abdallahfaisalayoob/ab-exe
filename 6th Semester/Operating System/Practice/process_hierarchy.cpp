#include <iostream>
#include <unistd.h>
#include <sys/types.h>
#include <sys/wait.h>

using namespace std;

int main()
{
    pid_t pid1, pid2;

    // first child
    pid1 = fork();

    if (pid1 == 0)
    {
        // CHILD 1
        cout << "Child 1 Process" << endl;
        cout << "PID: " << getpid() << endl;
        cout << "Parent PID: " << getppid() << endl;
        return 0;
    }

    // second child (only parent reaches here)
    pid2 = fork();

    if (pid2 == 0)
    {
        // CHILD 2
        cout << "Child 2 Process" << endl;
        cout << "PID: " << getpid() << endl;
        cout << "Parent PID: " << getppid() << endl;
        return 0;
    }

    // PARENT PROCESS
    wait(NULL);
    wait(NULL);

    cout << "Parent Process" << endl;
    cout << "PID: " << getpid() << endl;

    return 0;
}
