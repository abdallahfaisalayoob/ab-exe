clc;close all;clear all
Fs = 500; %sampling Frequency
f = 20;   % Signal’s Frequency
N = 100; % Total number of samples
n = 0:N-1; % n represents sample number
T = 1/Fs; % T represents sampling interval i.e., time between 2 samples
t = n*T;  % t = nTs = n/Fs
x = cos(2*pi*f*t);
Xk = fft(x)/N; % Computing fft
Y = abs(Xk);
X = fftshift(abs(Xk));  
fx = -Fs/2:Fs/length(X):Fs/2-(Fs/length(X));
subplot(211)
plot(t,x,'linewidth',2);
grid on; 
subplot(212)
stem(fx,X,'filled','linewidth',2);
grid on; 
xlabel('-Fs/2 to Fs/2','fontweight','bold');
ylabel('|X(k)|','fontweight','bold');
title('Frequency Domain Spectrum');
