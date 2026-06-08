
num2 = [200];
den2 = [0.1,0,200];

sys2 = tf(num2, den2)

poles_G2 = pole(sys2)
zeros_G2 = zero(sys2)
num1 = [0.1 0 200];
den1 = 0.02*conv([1 0 0],[1 0 3000]);

sys1 = tf(num1, den1)

poles_G1 = pole(sys1)
zeros_G1 = zero(sys1)
