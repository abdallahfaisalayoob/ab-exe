#include<iostream>
#include<unistd.h> //header file added for fork sys call.
#include<sys/types.h> //header file added for pid_t data type. This data type can be used to store process IDs.
using namespace std;
int main()
{
  //int pid;
  fork();
  fork();
  fork();
  //cout<<"Hello World"<<endl;
  cout<<"Hello World"<<endl;
  return 0;
  
 }
