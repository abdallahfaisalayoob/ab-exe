syms s
k1 = 200;
I1 = 0.1;
I2 = 0.2;
G1 = k1 / (I1 * I2 * s^2 * (s^2 + k1/I1 + k1/I2));
G2 = (I2 * s^2 * k1) / ((I1 * I2 * s^2) * (s^2 + k1/I1 + k1/I2));
eq1 = ilaplace(G1,s);
eq2 = ilaplace(G2,s);
disp('Inverse Laplace of G')
pretty(eq1)
disp('Inverse Laplace of H')
pretty(eq2)
subplot(2,1,1)
fplot(eq1, [-2, 5])
xlabel('t')
ylabel('G(t)')
title('Inverse Laplace of G')
subplot(2,1,2)
fplot(eq2, [-2, 5])
xlabel('t')
ylabel('H(t)')
title('Inverse Laplace of H')