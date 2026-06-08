clc; clear; close all;

num = [1];
den = conv([1 3],[1 2]);

sys = tf(num, den);

figure;
rlocus(sys); grid on;
title('Q1(a): Root Locus');

% Mark poles & zeros manually (safe method)
p = pole(sys); z = zero(sys);
hold on;
plot(real(p), imag(p),'x','MarkerSize',10,'LineWidth',2);
plot(real(z), imag(z),'o','MarkerSize',10,'LineWidth',2);

legend('Root Locus','Poles','Zeros');

% Gain selection
[K,poles] = rlocfind(sys)

% SISO TOOL (IMPORTANT)
rltool(sys)