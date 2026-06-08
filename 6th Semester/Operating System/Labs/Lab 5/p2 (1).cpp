#include<iostream>
#include<unistd.h>//header file added for fork and pipe sys call.
#include<string.h> 
#include<fcntl.h> 
using namespace std;
int main()
{
  int fd_r;
  char str[256]="Hello World";
  //opening pipe_one for read only mode
  fd_r=open("pipe_one",O_RDONLY); 
  if (fd_r<0)
  cout<<"Error in opening the file"<<endl;
  else 
  {
    while (strcmp(str,"exit")!=0) //str not equal to exit
    {
     
     read(fd_r,str,sizeof(str)); // reading pipe_one
     cout<<"Text:"<<str<<endl;
    } //end of while loop
    close(fd_r);
  } // end of else
  
  
  return 0;
 }
