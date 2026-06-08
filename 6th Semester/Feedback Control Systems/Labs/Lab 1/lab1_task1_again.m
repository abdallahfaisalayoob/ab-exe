%task 1
num = [ 2 1]
den= [ 10 3 2]

output =tf(num,den)

disp('siso model')
s=tf('s')
G= (2*s+1)/(10*s^2+3*s+2)