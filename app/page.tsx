"use client";

import "./style.css";
import { InferenceEngine, CVImage, Prediction } from "inferencejs";
import { useEffect, useRef, useState, useMemo } from "react";
import { v4 as uuidv4 } from 'uuid';
import { db } from "../src/config/firebase";
import { collection, addDoc } from "firebase/firestore";

// Define interfaces
interface Transaction {
  uuid: string;
  tx_start_dt: string;
  cart_checkout: {
    red_tulip: number;
    yellow_tulip: number;
    blue_iris: number;
  };
}

interface PriceList {
  [key: string]: number;
}

function App() {
  const inferEngine = useMemo(() => {
    return new InferenceEngine();
  }, []);
  const [modelWorkerId, setModelWorkerId] = useState<string | null>(null);
  const [modelLoading, setModelLoading] = useState(false);
  
  // Cash register state
  const [transaction, setTransaction] = useState<Transaction>({
    uuid: uuidv4(),
    tx_start_dt: new Date().toISOString(),
    cart_checkout: {
      red_tulip: 0,
      yellow_tulip: 0,
      blue_iris: 0
    }
  });
  const [txTotal, setTxTotal] = useState<number>(0);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [checkoutMessage, setCheckoutMessage] = useState<string>("");

  // Define price list
  const priceList: PriceList = {
    "red_tulip_1": 0.75,
    "yellow_tulip_1": 0.75,
    "blue_iris_1": 1.50
  };

  // Create refs for audio and middle line position
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  // Updated to store object with arm/scan/disarm states
  const previousPredictionsRef = useRef<{[key: string]: any}>({});
  const middleLineRef = useRef<number>(0);

  useEffect(() => {
    if (!modelLoading) {
      setModelLoading(true);
      inferEngine
        .startWorker("floral-shop-visual-checkout", 2, "rf_urmfUoKJ7hZhz9bJiQ9xNEtAw883")
        .then((id) => setModelWorkerId(id));
    }
  }, [inferEngine, modelLoading]);

  useEffect(() => {
    console.log("Model Worker ID: " + modelWorkerId);
    if (modelWorkerId) {
      startWebcam();
    }
  }, [modelWorkerId]);

  const startWebcam = () => {
    var constraints = {
      audio: false,
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: "environment",
      },
    };

    navigator.mediaDevices.getUserMedia(constraints).then((stream) => {
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = function () {
          if (videoRef.current) {
            videoRef.current.play();
          }
        };

        videoRef.current.onplay = () => {
          if (!canvasRef.current || !videoRef.current) return;
          
          var ctx = canvasRef.current.getContext("2d");
          if (!ctx) return;

          var height = videoRef.current.videoHeight;
          var width = videoRef.current.videoWidth;

          videoRef.current.width = width;
          videoRef.current.height = height;

          canvasRef.current.width = width;
          canvasRef.current.height = height;

          ctx.scale(1, 1);
          
          // Calculate middle line position
          middleLineRef.current = width / 2;
          console.log(`Video dimensions: ${width}x${height}, Middle line set at: ${middleLineRef.current}`);

          detectFrame();
        };
      }
    }).catch(error => {
      console.error("Error accessing webcam:", error);
    });
  };

  // Play cash register beep sound
  const playBeepSound = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(err => console.error("Error playing sound:", err));
    }
  };

  // Check if item has crossed the middle line with debounce logic
  const checkItemCrossedMiddle = (prediction: Prediction, frameWidth: number) => {
    const itemId = `${prediction.class}_${Math.round(prediction.bbox.x)}_${Math.round(prediction.bbox.y)}`;
    const middleX = middleLineRef.current;
    
    // Define arm, scan, and disarm regions (as percentages of frame width)
    const armRegion = middleX + (frameWidth * 0.15); // 15% to the right of middle
    const disarmRegion = middleX - (frameWidth * 0.15); // 15% to the left of middle
    
    // Get left and right edges of the bounding box
    const leftEdge = prediction.bbox.x - (prediction.bbox.width / 2);
    const rightEdge = prediction.bbox.x + (prediction.bbox.width / 2);
    
    // Debug boundaries
    console.log(`Item: ${prediction.class} - Left: ${leftEdge.toFixed(0)}, Right: ${rightEdge.toFixed(0)}, Middle: ${middleX.toFixed(0)}, Arm: ${armRegion.toFixed(0)}, Disarm: ${disarmRegion.toFixed(0)}`);
    
    // If this is a new object we haven't seen before, initialize its state
    if (previousPredictionsRef.current[itemId] === undefined) {
      console.log(`NEW ITEM: ${itemId} - Class: ${prediction.class}`);
      previousPredictionsRef.current[itemId] = {
        armed: false,
        scanned: false,
        disarmed: false,
        cleanupCounter: 0
      };
    }
    
    const itemState = previousPredictionsRef.current[itemId];
    
    // Debug item state
    console.log(`Item ${itemId} STATE: armed=${itemState.armed}, scanned=${itemState.scanned}, disarmed=${itemState.disarmed}`);
    
    // Step 1: Arm the scanner when right edge is in arm region
    if (!itemState.armed && rightEdge < armRegion && leftEdge > middleX) {
      itemState.armed = true;
      console.log(`🟢 Item ${itemId} ARMED - Right edge ${rightEdge.toFixed(0)} crossed arm region ${armRegion.toFixed(0)}`);
    }
    
    // Step 2: Scan the item when it crosses the middle line (only if armed)
    if (itemState.armed && !itemState.scanned && leftEdge < middleX && rightEdge > middleX) {
      itemState.scanned = true;
      console.log(`🔴 Item ${itemId} SCANNED - Object crossing middle line ${middleX.toFixed(0)}`);
      // Process the item
      processItemCheckout(prediction.class);
      return true;
    }
    
    // Step 3: Disarm the scanner when item fully passes to the left
    if (itemState.scanned && !itemState.disarmed && rightEdge < disarmRegion) {
      itemState.disarmed = true;
      console.log(`🔵 Item ${itemId} DISARMED - Right edge ${rightEdge.toFixed(0)} past disarm region ${disarmRegion.toFixed(0)}`);
    }
    
    // Clean up old items that are no longer in frame or have completed the cycle
    // We'll keep them in memory for a while to prevent immediate re-scanning
    const cleanupInterval = 60; // frames (approximately 2 seconds at 30fps)
    
    if (itemState.disarmed) {
      itemState.cleanupCounter++;
      
      if (itemState.cleanupCounter > cleanupInterval) {
        // Remove the item from tracking after the timeout
        console.log(`🗑️ Item ${itemId} REMOVED FROM TRACKING - cleanup counter: ${itemState.cleanupCounter}`);
        delete previousPredictionsRef.current[itemId];
      }
    }
    
    return itemState.scanned && !itemState.disarmed;
  };

  // Process item checkout
  const processItemCheckout = (itemClass: string) => {
    // Play beep sound
    playBeepSound();
    
    // Update cart and total based on item class
    let newTransaction = {...transaction};
    let price = 0;
    
    console.log(`Processing checkout for item class: ${itemClass}`);
    
    if (itemClass.includes("red_tulip")) {
      newTransaction.cart_checkout.red_tulip += 1;
      price = priceList["red_tulip_1"] || 0;
      console.log(`Added red tulip: ${newTransaction.cart_checkout.red_tulip} total, price: ${price}`);
    } else if (itemClass.includes("yellow_tulip")) {
      newTransaction.cart_checkout.yellow_tulip += 1;
      price = priceList["yellow_tulip_1"] || 0;
      console.log(`Added yellow tulip: ${newTransaction.cart_checkout.yellow_tulip} total, price: ${price}`);
    } else if (itemClass.includes("blue_iris")) {
      newTransaction.cart_checkout.blue_iris += 1;
      price = priceList["blue_iris_1"] || 0;
      console.log(`Added blue iris: ${newTransaction.cart_checkout.blue_iris} total, price: ${price}`);
    } else {
      console.log(`Unknown item class: ${itemClass}, not adding to cart`);
    }
    
    // Update state
    setTransaction(newTransaction);
    setTxTotal(prevTotal => {
      const newTotal = prevTotal + price;
      console.log(`Transaction total updated: ${prevTotal.toFixed(2)} -> ${newTotal.toFixed(2)}`);
      return newTotal;
    });
  };

  // Handle payment submission
  const handlePayment = async () => {
    try {
      setIsSubmitting(true);
      
      // Add transaction to Firestore
      await addDoc(collection(db, "transactions"), transaction);
      
      // Reset transaction
      setTransaction({
        uuid: uuidv4(),
        tx_start_dt: new Date().toISOString(),
        cart_checkout: {
          red_tulip: 0,
          yellow_tulip: 0,
          blue_iris: 0
        }
      });
      setTxTotal(0);
      setCheckoutMessage("Payment successful!");
      
      // Clear message after 3 seconds
      setTimeout(() => setCheckoutMessage(""), 3000);
    } catch (error) {
      console.error("Error submitting payment:", error);
      setCheckoutMessage("Payment failed. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const detectFrame = () => {
    if (!modelWorkerId || !videoRef.current || !canvasRef.current) {
      setTimeout(detectFrame, 100 / 3);
      return;
    }

    const img = new CVImage(videoRef.current);
    inferEngine.infer(modelWorkerId, img).then((predictions: Prediction[]) => {
      if (!canvasRef.current) return;
      
      var ctx = canvasRef.current.getContext("2d");
      if (!ctx) return;
      
      ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      
      // Debug frame info
      console.log(`Canvas dimensions: ${canvasRef.current.width}x${canvasRef.current.height}`);
      console.log(`Middle line at: ${middleLineRef.current.toFixed(0)}`);
      console.log(`Total predictions: ${predictions.length}`);
      
      // Define regions
      const armRegion = middleLineRef.current + (canvasRef.current.width * 0.15);
      const disarmRegion = middleLineRef.current - (canvasRef.current.width * 0.15);
      
      // Draw arm region line (green)
      ctx.beginPath();
      ctx.moveTo(armRegion, 0);
      ctx.lineTo(armRegion, canvasRef.current.height);
      ctx.strokeStyle = "rgba(0, 255, 0, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw middle line (red)
      ctx.beginPath();
      ctx.moveTo(middleLineRef.current, 0);
      ctx.lineTo(middleLineRef.current, canvasRef.current.height);
      ctx.strokeStyle = "rgba(255, 0, 0, 0.7)";
      ctx.lineWidth = 2;
      ctx.stroke();
      
      // Draw disarm region line (blue)
      ctx.beginPath();
      ctx.moveTo(disarmRegion, 0);
      ctx.lineTo(disarmRegion, canvasRef.current.height);
      ctx.strokeStyle = "rgba(0, 0, 255, 0.5)";
      ctx.lineWidth = 2;
      ctx.stroke();

      // Draw debug text for region positions
      ctx.font = "16px monospace";
      ctx.fillStyle = "white";
      ctx.fillText(`Arm: ${armRegion.toFixed(0)}`, armRegion - 50, 20);
      ctx.fillText(`Middle: ${middleLineRef.current.toFixed(0)}`, middleLineRef.current - 50, 20);
      ctx.fillText(`Disarm: ${disarmRegion.toFixed(0)}`, disarmRegion - 50, 20);

      for (var i = 0; i < predictions.length; i++) {
        var prediction = predictions[i];
        
        // Check if item crossed middle line
        const scanned = checkItemCrossedMiddle(prediction, canvasRef.current.width);
        
        // Draw item ID on top of bounding box for debugging
        const itemId = `${prediction.class}_${Math.round(prediction.bbox.x)}_${Math.round(prediction.bbox.y)}`;
        const itemState = previousPredictionsRef.current[itemId];
        const stateText = itemState ? 
          `A:${itemState.armed ? 1 : 0} S:${itemState.scanned ? 1 : 0} D:${itemState.disarmed ? 1 : 0}` : 
          'New';

        // Draw detections
        ctx.strokeStyle = prediction.color;

        var x = prediction.bbox.x - prediction.bbox.width / 2;
        var y = prediction.bbox.y - prediction.bbox.height / 2;
        var width = prediction.bbox.width;
        var height = prediction.bbox.height;

        ctx.rect(x, y, width, height);
        ctx.fillStyle = "rgba(0, 0, 0, 0)";
        ctx.fill();
        ctx.fillStyle = ctx.strokeStyle;
        ctx.lineWidth = 4;
        ctx.strokeRect(x, y, width, height);

        var text = ctx.measureText(
          prediction.class + " " + Math.round(prediction.confidence * 100) + "%"
        );
        ctx.fillStyle = ctx.strokeStyle;
        ctx.fillRect(x - 2, y - 30, text.width + 4, 30);
        ctx.font = "15px monospace";
        ctx.fillStyle = "black";
        ctx.fillText(
          prediction.class +
            " " +
            Math.round(prediction.confidence * 100) +
            "%",
          x,
          y - 10
        );
        
        // Draw state debug text
        ctx.fillStyle = "white";
        ctx.fillRect(x - 2, y - 60, text.width + 60, 30);
        ctx.fillStyle = "black";
        ctx.fillText(stateText, x, y - 40);
      }

      setTimeout(detectFrame, 100 / 3);
    });
  };
  
  return (
    <div>
      <div style={{ position: "relative" }}>
        <video
          id="video"
          width="640"
          height="480"
          ref={videoRef}
          style={{ position: "relative" }}
        />
        <canvas
          id="canvas"
          width="640"
          height="480"
          ref={canvasRef}
          style={{ position: "absolute", top: 0, left: 0 }}
        />
        {/* Hidden audio element for beep sound */}
        <audio ref={audioRef} src="/cash-register-sound.mp3" style={{ display: "none" }} />
      </div>
      
      {/* Checkout Information */}
      <div style={{ marginTop: "20px", padding: "20px", backgroundColor: "#f5f5f5", borderRadius: "10px" }}>
        <h2>Flower Shop Checkout</h2>
        
        <div style={{ marginTop: "10px" }}>
          <h3>Cart Items:</h3>
          <ul>
            <li>Red Tulips: {transaction.cart_checkout.red_tulip} × $0.75 = ${(transaction.cart_checkout.red_tulip * 0.75).toFixed(2)}</li>
            <li>Yellow Tulips: {transaction.cart_checkout.yellow_tulip} × $0.75 = ${(transaction.cart_checkout.yellow_tulip * 0.75).toFixed(2)}</li>
            <li>Blue Iris: {transaction.cart_checkout.blue_iris} × $1.50 = ${(transaction.cart_checkout.blue_iris * 1.50).toFixed(2)}</li>
          </ul>
        </div>
        
        <div style={{ marginTop: "20px", display: "flex", gap: "15px" }}>
          <button 
            className="hero_button_secondary"
            style={{ backgroundColor: "#4CAF50" }}
          >
            Total: ${txTotal.toFixed(2)}
          </button>
          
          <button 
            className="hero_button_secondary"
            onClick={handlePayment}
            disabled={isSubmitting || txTotal <= 0}
          >
            {isSubmitting ? "Processing..." : "Pay Now"}
          </button>
        </div>
        
        {checkoutMessage && (
          <div style={{ 
            marginTop: "10px", 
            padding: "10px", 
            backgroundColor: checkoutMessage.includes("successful") ? "#DFF2BF" : "#FFBABA",
            color: checkoutMessage.includes("successful") ? "#4F8A10" : "#D8000C",
            borderRadius: "5px" 
          }}>
            {checkoutMessage}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;