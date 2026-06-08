clc
clear
close all

% Constants
a = 1/30;
c = 1.667e-6;

% K values
K = [200 400 1000 2000];

for i = 1:length(K)

    num = c*K(i);
    den = [1 a c*K(i)];

    sys = tf(num,den);

    subplot(2,2,i)
    step(sys,400)
    title(['K = ',num2str(K(i))])
    grid on

    info = stepinfo(sys);

    disp(['K = ',num2str(K(i))])
    disp(['Rise Time = ',num2str(info.RiseTime)])
    disp(['Overshoot = ',num2str(info.Overshoot)])
    disp(' ')
end