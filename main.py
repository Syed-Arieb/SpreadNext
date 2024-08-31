import sys
from PySide6.QtWidgets import QApplication, QWidget, QLabel, QPushButton

class HelloWorldApp(QWidget):
    
    title = "Hello World"
    
    def __init__(self):
        super().__init__()

        self.initUI()

    def initUI(self):
        label = QLabel("Hello, World!", self)
        label.move(10, 10)
        
        button = QPushButton(text="Reload", parent=self)
        button.move(180, 3)

        self.setGeometry(300, 300, 300, 200)
        self.setWindowTitle(self.title)
        self.setStyleSheet(self.getStyleSheet())
        self.show()
        
    def getStyleSheet(self):
        with open('./res/main.css', "r") as f:
            return f.read()

if __name__ == '__main__':
    app = QApplication(sys.argv)
    ex = HelloWorldApp()
    sys.exit(app.exec())