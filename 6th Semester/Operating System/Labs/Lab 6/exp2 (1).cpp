#include<iostream>
#include<unistd.h> //for sleep function
#include<stdlib.h>
#include<pthread.h>
using namespace std;
void* myturn(void* arg)
{
   for (int i=0; i<8; i++)
   {
      sleep(1);
      cout<<"My turn"<<endl;
   }
   return NULL;
}

void yourturn()
{
   for (int i=0; i<3; i++)
   {
      sleep(2);
      cout<<"Your turn"<<endl;
   }
}

int main()
{
   pthread_t newthread;
   pthread_create(&newthread,NULL,myturn,NULL);
   yourturn();
   pthread_join(newthread, NULL);
   return 0;
}
