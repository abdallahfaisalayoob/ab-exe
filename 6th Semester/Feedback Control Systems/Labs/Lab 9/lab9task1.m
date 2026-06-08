clc; clear; close all;
s = tf('s');

E = 1.01/((s+1)*(((s+0.1)^2)+1));
F = (((s+0.1)^2)+1)/((s+1)*(((s+0.1)^2)+1));
G = ((1.01/1.0625)*(((s+0.25)^2)+1))/((s+1)*(((s+0.1)^2)+1));
H = ((1.01/1.25)*(((s+0.5)^2)+1))/((s+1)*(((s+0.1)^2)+1));

% Pole-zero map (Part c analysis)
figure;
pzmap(E, F, G, H);
grid on;
legend('E(s) - no zero', 'F(s) - a=0.1', 'G(s) - a=0.25', 'H(s) - a=0.5');

% Full step response comparison
figure;
step(E); hold on;
step(F); hold on;
step(G); hold on;
step(H);
grid on;
title('Step Response - Effect of Zero Proximity');
xlim([0 20]);
legend('No zero', '\alpha=0.1', '\alpha=0.25', '\alpha=0.5');