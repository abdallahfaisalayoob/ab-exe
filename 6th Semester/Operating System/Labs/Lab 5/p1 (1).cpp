#include<iostream>
#include<unistd.h>//header file added for fork and pipe sys call.
#include<string.h> 
#include<fcntl.h> 
using namespace std;
int main()
{
  int fd_w;
  char str[256]="Hello World";
  //opening pipe_one for write only mode
  fd_w=open("pipe_one",O_WRONLY); 
  if (fd_w<0)
  cout<<"Error in opening the file"<<endl;
  else 
  {
    while (strcmp(str,"exit")!=0) //str not equal to exit
    {
     cout<<"Enter the string"<<endl;
     cin.getline(str,256);
     write(fd_w,str,sizeof(str)); // writing into pipe_one
     //cout<<"*"<<str<<"*"<<endl;
    } //end of while loop
     close(fd_w);
  } // end of else
 
  
  return 0;
 }
