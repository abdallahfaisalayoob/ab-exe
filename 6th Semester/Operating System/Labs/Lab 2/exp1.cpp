#include<iostream>
#include<unistd.h> //header file added for fork sys call.
#include<sys/types.h> //header file added for pid_t data type. This data type can be used to store process IDs.
using namespace std;
int main()
{
  //int pid;
  pid_t pid = fork();
  if (pid==0) // this check will pass only for child process
  { 
     cout<<"I am child process"<<endl;
      return 0;
  }
  else if (pid>0) // this check will pass only for parent process
  {
     cout<<"I am parent process"<<endl;
      return 0;
  }
  else 
  {
    cout<<"Error in Fork"<<endl;
    return 0;
  }
 
 }
