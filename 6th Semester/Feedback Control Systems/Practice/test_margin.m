clc;
clear;
close all;

m = 0.11;
R = 0.015;
d = 0.03;
g = -9.8;
L_beam = 1.0;
I = 9.99e-6;

Kp = -(m*g*d/L_beam)/(I/R^2 + m);

s = tf('s');
G = Kp/s^2;

Ts_req = 3;
wc = 4/Ts_req;
PM_req = 70;

magG_wc = Kp/wc^2;

zc = 0.005;
pc = wc/tand(atand(wc/zc) - PM_req);

Dc = (s+zc)/(s+pc);

attn = abs((1j*wc+zc)/(1j*wc+pc));

K = 1/(magG_wc*attn);

Dcl = K*Dc;
Lol = Dcl*G;

disp('================================================');
disp('DEBUG VALUES');
disp('================================================');
fprintf('pc   = %.6f\n',pc);
fprintf('attn = %.6f\n',attn);
fprintf('K    = %.6f\n',K);

disp(' ');
disp('Transfer Function Lol:')
Lol

disp(' ');
disp('Poles:')
pole(Lol)

disp(' ');
disp('Zeros:')
zero(Lol)

disp(' ');
disp('Calling margin...')

try
    [Gm,Pm,Wcg,Wcp] = margin(Lol);

    disp('margin completed successfully')

    fprintf('Gm  = %f\n',Gm);
    fprintf('Pm  = %f\n',Pm);
    fprintf('Wcg = %f\n',Wcg);
    fprintf('Wcp = %f\n',Wcp);

catch ME

    disp('ERROR OCCURRED INSIDE margin()')
    disp(ME.message)

end

disp(' ');
disp('Calling allmargin...')

try

    M = allmargin(Lol);

    disp('allmargin completed successfully')
    disp(M)

catch ME

    disp('ERROR OCCURRED INSIDE allmargin()')
    disp(ME.message)

end

figure;
margin(Lol);
grid on;
title('Margin Plot');

disp('Finished script.')
