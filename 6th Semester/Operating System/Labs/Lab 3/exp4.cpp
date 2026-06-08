#include<iostream>
#include<unistd.h> //header file added for fork sys call.
#include<sys/types.h> //header file added for pid_t data type. This data type can be used to store process IDs.
#include<sys/wait.h> // header file added for wait sys call.
#include<stdlib.h> // header file added for exit sys call.
using namespace std;
int main()
{
  int status;
  pid_t pid = fork();
  if (pid==0) // this check will pass only for child process
  { 
     cout<<"I am child process with pid="<<getpid()<<endl;
     execl("./p1.out","./p1.out",NULL);
     cout<<"exac failed"<<endl;
  }
  else if (pid>0) // this check will pass only for parent process
  {
    cout<<"I am parent process with pid="<<getpid()<<" and I am waiting for my child to terminate"<<endl;
    pid_t exitchild_pid = wait(&status);
    //wait(&status);
    cout<<"I am parent process and child with pid="<<exitchild_pid<<" is exited"<<endl; 
    
    return 0;
  }
  else 
  {
    cout<<"Error in Fork"<<endl;
    return 0;
  }
 
 }
