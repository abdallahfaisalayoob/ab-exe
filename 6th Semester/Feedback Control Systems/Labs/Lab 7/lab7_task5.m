zeta = 0.6;
wn = 3;

G1 = tf([wn^2],[1 2*zeta*wn wn^2]);

figure
step(G1)
title('Step Response of Designed System')
grid on

figure
pzmap(G1)
title('Pole-Zero Map of Designed System')
grid on

info = stepinfo(G1);

fprintf('Settling Time: ', info.SettlingTime);
fprintf('Overshoot: ', info.Overshoot);