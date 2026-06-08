#include<iostream>
#include<stdio.h> 
#include<unistd.h>//header file added for fork and pipe sys call.
#include<stdlib.h> // header file added for exit sys call.
#include<sys/stat.h> 
#include<sys/wait.h> // header file added for wait sys call.

using namespace std;
int main()
{
  int f1,f2;
  f1=mkfifo("pipe_one",666); // creating pipe one
  if (f1<0)
  cout<<"Pipe one not created"<<endl;
  else 
  cout<<"Pipe one sucessfully created"<<endl;
  
  f2=mkfifo("pipe_two",666);
  if (f2<0)
  cout<<"Pipe two not created"<<endl;
  else 
  cout<<"Pipe two sucessfully created"<<endl;
  return 0;
 }
