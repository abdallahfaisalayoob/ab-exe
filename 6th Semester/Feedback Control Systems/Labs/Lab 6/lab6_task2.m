C = 1*10^(-3);

R1 = 1000
R2 = 2000

num_1 = [1];
den_1 = [R1*C 1];

num_2 = [1];
den_2 = [R2*C 1];

G = tf(num_1,den_1);
H = tf(num_2,den_2);

figure
step(G)
hold on
step(H)
legend('G (R=1k)','H (R=2k)')
title('Step Response')
grid on

figure
impulse(G)
hold on
impulse(H)
legend('G (R=1k)','H (R=2k)')
title('Impulse Response')
grid on