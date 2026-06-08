s=tf('s')
G1=2/s
G2=4/s
G4=1/s
G6=1/s
SYS1 = parallel(G1,G2)
SYS2=series(SYS1,G4)
SYS3=feedback(SYS2,G6)



