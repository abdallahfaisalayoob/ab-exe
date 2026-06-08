num=[1 0 0 -1]
den = [ 4 0 0 3 2]

g = tf(num,den)

disp('siso model')
s=tf('s')
G= (s^3 -1)/(4 *s^4 +3*s+2)