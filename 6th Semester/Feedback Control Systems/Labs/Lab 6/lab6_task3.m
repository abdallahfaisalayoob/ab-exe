
%CASE 1

num_H = [1];
den_H = [1 1];

num_F = [2];
den_F = [1 2];

num_G = [3];
den_G = [1 3];

H = tf(num_H,den_H);
F = tf(num_F,den_F);
G = tf(num_G,den_G);

figure
pzmap(H)
hold on
pzmap(F)
pzmap(G)
legend('H','F','G')
title('Pole Zero Map (Stable)')
grid on

figure
impulse(H)
hold on
impulse(F)
impulse(G)
legend('H','F','G')
title('Impulse Response')
grid on

figure
step(H)
hold on
step(F)
step(G)
legend('H','F','G')
title('Step Response')
grid on


% CASE 2

num_H = [1];
den_H = [1 -1];

num_F = [2];
den_F = [1 -2];

num_G = [3];
den_G = [1 -3];

H = tf(num_H,den_H);
F = tf(num_F,den_F);
G = tf(num_G,den_G);

figure
pzmap(H)
hold on
pzmap(F)
pzmap(G)
legend('H','F','G')
title('Pole Zero Map (Unstable)')
grid on

figure
impulse(H)
hold on
impulse(F)
impulse(G)
legend('H','F','G')
title('Impulse Response')
grid on

figure
step(H)
hold on
step(F)
step(G)
legend('H','F','G')
title('Step Response')
grid on


%CASE 3

num_H = [0.5];
den_H = [1 1.5 0.5];

num_F = [2];
den_F = [1 3 2];

num_G = [12];
den_G = [1 7 12];

H = tf(num_H,den_H);
F = tf(num_F,den_F);
G = tf(num_G,den_G);

figure
pzmap(H)
hold on
pzmap(F)
pzmap(G)
legend('H','F','G')
title('Pole Zero Map (Two Poles)')
grid on

figure
impulse(H)
hold on
impulse(F)
impulse(G)
legend('H','F','G')
title('Impulse Response')
grid on

figure
step(H)
hold on
step(F)
step(G)
legend('H','F','G')
title('Step Response')
grid on